"""Scrape Hanover College's catalog (catalog.hanover.edu) into `majors.json` —
programs, their requirement texts, the union course catalog, and faculty.

Scraping quirks to keep in mind when reading the output:

- Course codes from the Search API carry extra whitespace (`BIO  161`);
  `normalize_code()` collapses runs of whitespace and uppercases.
- Program `id`s are derived from the program *name* (non-alphanumerics removed,
  lowercased) — the source HTML anchors' ids are unreliable.
- Faculty names are normalized (`normalize_faculty_name`) and deduped per
  program.
- The global `catalog` index is the union of the Search API and every program's
  course list, so program-only codes resolve.
- Disagreements between the two endpoints are *not* silently resolved: they are
  recorded at the top level of `majors.json` in `source_discrepancies`
  (description conflicts) and `presence_discrepancies` (search-only /
  program-only).
"""

import argparse
import json
import os
import re
import time
from collections import Counter
from datetime import date

import requests
from bs4 import BeautifulSoup

# Repo root (this script lives in tools/catalog-pipeline/): data files are
# committed at the root so the static apps can fetch them.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE_URL = 'https://catalog.hanover.edu'
# Pause between requests to the catalog host to avoid flooding it.
REQUEST_DELAY = 1.0


def _fold(text):
    """Collapse a description into a comparable lowercase word soup."""
    return re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()


def fetch_html():
    r = requests.get(BASE_URL)
    r.raise_for_status()
    return r.text


def fetch_all_courses():
    r = requests.post(BASE_URL, data={'action': 'get_courses', 'course_name': '', 'course_program': ''})
    r.raise_for_status()
    return r.json()['courses']['courses']


def normalize_code(code):
    return re.sub(r'\s+', ' ', code).strip().upper()


def normalize_faculty_name(name):
    name = re.sub(r'\s+', ' ', name).strip()
    return re.sub(r'\.$', '', name)


def fetch_program_courses(prefix):
    r = requests.post(BASE_URL, data={'action': 'get_program_courses_file', 'program_course': prefix})
    r.raise_for_status()
    data = r.json()
    html = data.get('program_courses', '')
    if not html:
        return []
    soup = BeautifulSoup(html, 'html.parser')
    courses = []
    for p in soup.select('p.program_course'):
        code_el = p.select_one('span.course_code')
        name_el = p.select_one('span.course_name')
        desc_el = p.select_one('span.course_description')
        code = normalize_code(code_el.get_text(strip=True)) if code_el else ''
        name = name_el.get_text(strip=True) if name_el else ''
        desc = desc_el.get_text(strip=True) if desc_el else ''
        if desc.startswith('- '):
            desc = desc[2:]
        courses.append({'course_code': code, 'course_name': name, 'description': desc})
    return courses


def parse_prerequisites(description):
    if not description:
        return []
    prereqs = []
    for pattern in [r'Prerequisites?:\s*([^\.]+)\.', r'Prerequisites?:\s*([^\.]+)']:
        m = re.search(pattern, description, re.IGNORECASE)
        if m:
            prereq_text = m.group(1).strip()
            prereqs = [p.strip() for p in re.split(r'[,;]', prereq_text) if p.strip()]
            break
    return prereqs


def parse_requirement_block(strong_tag):
    label = strong_tag.get_text(strip=True).rstrip(':').strip()
    full_text = strong_tag.parent.get_text(' ', strip=True)
    strong_text = strong_tag.get_text(strip=True)
    if full_text.startswith(strong_text):
        body = full_text[len(strong_text) :].strip().lstrip(':').strip()
    else:
        body = full_text
    return label, body


def normalize_prefixes_in_text(text, known_prefixes):
    # Uppercase department prefixes only when they head a course number
    # (e.g. "bio 161" -> "BIO 161"). Deliberately requires a following digit so
    # plain-English words that happen to match a prefix (his, id, ml, mat, soc,
    # com, lat) are never rewritten.
    sorted_prefixes = sorted(known_prefixes, key=len, reverse=True)
    for prefix in sorted_prefixes:
        text = re.sub(
            rf'\b{re.escape(prefix)}\s*(\d)',
            lambda m, p=prefix: f'{p.upper()} {m.group(1)}',
            text,
            flags=re.IGNORECASE,
        )
    return text


def build_program_requirements(content, known_prefixes=None, program_name=None):
    requirements = {}
    key_counts = {}
    strong_tags = content.find_all('strong')
    # Requirement blocks are labeled with Major/Minor/Bachelor/etc. OR are
    # program-name-prefixed tracks ("Communication: Media."). Nested subheadings
    # like "Cognate courses:" share a <p> with their parent block and are not
    # matched here; they stay part of that block's text.
    requirement_keywords = (
        'Major',
        'Minor',
        'Bachelor',
        'Elementary',
        'Secondary',
        'Sports',
        'German',
        'German Studies',
    )
    for st in strong_tags:
        txt = st.get_text(strip=True)
        if txt in ('Faculty:', 'Course Descriptions:'):
            continue
        if txt.startswith('Faculty'):
            continue
        is_requirement = any(kw in txt for kw in requirement_keywords)
        if not is_requirement and program_name:
            is_requirement = txt.lower().startswith(program_name.lower().rstrip(':').strip())
        if not is_requirement:
            continue
        label, body = parse_requirement_block(st)
        if known_prefixes:
            body = normalize_prefixes_in_text(body, known_prefixes)
        key = label.lower().replace(' ', '_').replace('–', '-').replace('—', '-')
        key = re.sub(r'[^a-z0-9_]', '', key)
        if not key:
            key = 'requirement'
        if key in key_counts:
            key_counts[key] += 1
            key = f'{key}_{key_counts[key]}'
        else:
            key_counts[key] = 1
        requirements[key] = {
            'label': label,
            'text': body,
        }
    return requirements


def build_course_map(all_courses):
    course_map = {}
    for c in all_courses:
        code = normalize_code(c['course_code'])
        desc = c.get('course_description', '') or ''
        course_map[code] = {
            'course_code': code,
            'course_name': c.get('course_name', ''),
            'description': desc,
            'prerequisites': parse_prerequisites(desc),
            'credit_hours': c.get('course_credit_hours', ''),
            'program': c.get('course_program', ''),
        }
    return course_map


def merge_program_course(base, pc, program_name, discrepancies, seen):
    """Merge a program-page course record with the get_courses row.

    The program page is the canonical description (what students see); the
    get_courses row keeps its richer fields. When the two texts differ, the
    disagreement is recorded so it can be reported back to the catalog admins.
    """
    code = pc['course_code']
    rec = dict(base)
    pdesc = (pc.get('description') or '').strip()
    gdesc = (base.get('description') or '').strip()
    rec['description'] = pdesc or gdesc
    rec['alt_description'] = gdesc
    if pdesc and gdesc and code not in seen and _fold(pdesc) != _fold(gdesc):
        seen.add(code)
        discrepancies.append(
            {
                'code': code,
                'program': program_name,
                'program_description': pdesc,
                'search_description': gdesc,
            }
        )
    return rec


def derive_prefix(course_map, name):
    """The course-code prefix get_courses attributes to a program, or ''."""
    counts = Counter()
    for code, c in course_map.items():
        if c.get('program') == name:
            counts[code.split(' ')[0]] += 1
    if not counts:
        return ''
    return counts.most_common(1)[0][0]


def build_presence_discrepancies(all_courses_api, pc_cache, course_map, programs_data):
    """Codes that show up in only one of the two sources.

    `search-only` codes are known to the Course Search endpoint (`get_courses`)
    but appear on no program page; `program-only` codes appear on a program page
    but not in Course Search. Either way the sources disagree on the course's
    existence, so the entry is recorded for the admin report (CAT7).
    """
    search_codes = {normalize_code(c['course_code']) for c in all_courses_api}
    prefix_to_programs = {}
    for p in programs_data:
        pre = p.get('course_prefix')
        if pre:
            prefix_to_programs.setdefault(pre, []).append(p['name'])
    prog_info = {}
    for prefix, courses in pc_cache.items():
        progs = prefix_to_programs.get(prefix, [prefix])
        for pc in courses:
            info = prog_info.setdefault(
                pc['course_code'], {'names': set(), 'title': pc.get('course_name', '')}
            )
            info['names'].update(progs)
    prog_codes = set(prog_info)
    rows = []
    for code in sorted(search_codes - prog_codes):
        cm = course_map.get(code, {})
        rows.append(
            {
                'code': code,
                'side': 'search-only',
                'program': cm.get('program', ''),
                'title': cm.get('course_name', ''),
            }
        )
    for code in sorted(prog_codes - search_codes):
        info = prog_info[code]
        rows.append(
            {
                'code': code,
                'side': 'program-only',
                'program': ', '.join(sorted(info['names'])),
                'title': info['title'],
            }
        )
    return rows


def get_known_prefixes(programs_soup):
    prefixes = set()
    for p in programs_soup.select('div.program'):
        pd = p.select_one('div.program_courses')
        if pd and pd.get('id'):
            prefixes.add(pd['id'])
    return prefixes


def main():
    print('Fetching main HTML...')
    html = fetch_html()
    time.sleep(REQUEST_DELAY)
    soup = BeautifulSoup(html, 'html.parser')
    programs_section = soup.find('section', id='programs')
    if not programs_section:
        print('ERROR: Could not find programs section')
        return
    program_divs = programs_section.find_all('div', class_='program')
    print(f'Found {len(program_divs)} programs in HTML')

    known_prefixes = get_known_prefixes(programs_section)
    print(f'Found {len(known_prefixes)} course prefixes: {sorted(known_prefixes)}')

    all_courses_api = fetch_all_courses()
    print(f'Fetched {len(all_courses_api)} courses from API')
    time.sleep(REQUEST_DELAY)
    course_map = build_course_map(all_courses_api)

    discrepancies = []
    seen_discrepancies = set()
    pc_cache = {}
    programs_data = []

    for p in program_divs:
        header_a = p.select_one('.program_header a')
        name = header_a.get_text(strip=True) if header_a else ''
        pid = re.sub(r'[^a-zA-Z0-9]', '', name.strip().replace(' ', '')).lower()
        content = p.select_one('.program_content')
        if not content:
            continue

        faculty = ''
        desc = ''
        strongs = content.find_all('strong')
        paras = content.find_all('p')
        for para in paras:
            st = para.find('strong')
            if not st:
                continue
            stxt = st.get_text(strip=True)
            if 'Faculty' in stxt:
                faculty = para.get_text().replace('Faculty:', '', 1).strip()
                break

        for para in paras:
            st = para.find('strong')
            if st and 'Faculty' not in st.get_text():
                break
            if not st and re.search(r'[A-Z]', para.get_text()):
                desc = para.get_text(strip=True)
                break

        if not desc:
            for para in paras:
                st = para.find('strong')
                if not st:
                    txt = para.get_text(strip=True)
                    if len(txt) > 50:
                        desc = txt
                        break

        prefix_div = p.select_one('div.program_courses')
        prefix = prefix_div.get('id', '') if prefix_div else ''
        if not prefix:
            # Home page has no program_courses div for cross-cutting programs
            # (e.g. Social Justice, Health and Fitness). Derive their course
            # prefix from the codes get_courses already attributes to them so
            # their program-page descriptions/designations are still captured.
            prefix = derive_prefix(course_map, name)

        requirements = build_program_requirements(content, known_prefixes=known_prefixes, program_name=name)

        program_courses = []
        if prefix:
            if prefix not in pc_cache:
                print(f'  Fetching courses for {name} ({prefix})...')
                pc_cache[prefix] = fetch_program_courses(prefix)
                time.sleep(REQUEST_DELAY)
            p_courses = pc_cache[prefix]
            for pc in p_courses:
                code = pc['course_code']
                if code in course_map:
                    program_courses.append(
                        merge_program_course(course_map[code], pc, name, discrepancies, seen_discrepancies)
                    )
                else:
                    program_courses.append(pc)

        if not program_courses and prefix:
            for code, cc in course_map.items():
                if cc.get('program', '') == name or code.startswith(prefix):
                    program_courses.append(cc)

        program_types = set()
        has_major_block = any('major' in key.lower() for key in requirements)
        has_minor_block = any('minor' in key.lower() for key in requirements)
        # A program whose majors are name-prefixed tracks ("Communication:
        # Media.") has no 'major' key, so treat any non-minor requirement block
        # alongside a minor as evidence of a major offering.
        non_minor_blocks = [
            key
            for key in requirements
            if 'minor' not in key.lower() and key not in ('program', 'requirement')
        ]
        if has_major_block or (has_minor_block and non_minor_blocks):
            program_types.add('major')
        if has_minor_block:
            program_types.add('minor')
        if not program_types:
            program_types.add('program')

        faculty_names = []
        seen = set()
        for f in faculty.split(','):
            fname = normalize_faculty_name(f)
            if fname and fname not in seen:
                seen.add(fname)
                faculty_names.append(fname)

        entry = {
            'id': pid,
            'name': name,
            'type': list(program_types),
            'faculty': faculty_names,
            'description': desc,
            'course_prefix': prefix,
            'requirements': requirements,
            'course_count': len(program_courses),
            'courses': program_courses,
        }
        programs_data.append(entry)
        print(f'  {name}: {len(program_courses)} courses, {len(requirements)} requirement(s)')

    # Master catalog: every course the API knows about, plus every course any
    # program lists. The per-program endpoint returns codes the all-courses API
    # misses (e.g. GEO 161, CHE 372), so unioning keeps the planner universe
    # complete and cross-listed/orphan codes resolvable.
    catalog = dict(sorted(course_map.items()))
    for p in programs_data:
        for c in p['courses']:
            catalog[c['course_code']] = c
    catalog = dict(sorted(catalog.items()))

    output = {
        'catalog_year': '2025-2026',
        'generated_at': date.today().isoformat(),
        'source_url': 'https://catalog.hanover.edu/#programs',
        'total_programs': len(programs_data),
        'total_courses': len(catalog),
        'source_discrepancies': discrepancies,
        'presence_discrepancies': build_presence_discrepancies(
            all_courses_api, pc_cache, course_map, programs_data
        ),
        'catalog': catalog,
        'programs': programs_data,
    }

    with open(os.path.join(ROOT, 'majors.json'), 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f'\nWritten majors.json ({len(programs_data)} programs, {len(catalog)} total courses)')
    if discrepancies:
        print(f'{len(discrepancies)} source description disagreement(s):')
        for d in discrepancies:
            print(f'  {d["code"]} ({d["program"]})')


if __name__ == '__main__':
    main()
