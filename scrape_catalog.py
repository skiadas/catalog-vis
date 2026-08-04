import requests
import json
import re
from bs4 import BeautifulSoup

BASE_URL = 'https://catalog.hanover.edu'


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
    sorted_prefixes = sorted(known_prefixes, key=len, reverse=True)
    for prefix in sorted_prefixes:
        text = re.sub(
            rf'\b{re.escape(prefix)}\s*(\d)',
            lambda m, p=prefix: f'{p.upper()} {m.group(1)}',
            text,
            flags=re.IGNORECASE,
        )
        text = re.sub(
            rf'\b{re.escape(prefix)}\s+', lambda m, p=prefix: f'{p.upper()} ', text, flags=re.IGNORECASE
        )
    return text


def build_program_requirements(content, program_prefix, known_prefixes=None):
    requirements = {}
    key_counts = {}
    strong_tags = content.find_all('strong')
    for st in strong_tags:
        txt = st.get_text(strip=True)
        if txt in ('Faculty:', 'Course Descriptions:'):
            continue
        if txt.startswith('Faculty'):
            continue
        if any(
            kw in txt
            for kw in (
                'Major',
                'Minor',
                'Bachelor',
                'Elementary',
                'Secondary',
                'Sports',
                'German',
                'German Studies',
            )
        ):
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
    course_map = build_course_map(all_courses_api)

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

        requirements = build_program_requirements(content, prefix, known_prefixes=known_prefixes)

        program_courses = []
        if prefix:
            print(f'  Fetching courses for {name} ({prefix})...')
            p_courses = fetch_program_courses(prefix)
            for pc in p_courses:
                code = pc['course_code']
                if code in course_map:
                    program_courses.append(course_map[code])
                else:
                    program_courses.append(pc)

        if not program_courses and prefix:
            for code, cc in course_map.items():
                if cc.get('program', '') == name or code.startswith(prefix):
                    program_courses.append(cc)

        program_types = set()
        for key in requirements:
            if 'major' in key.lower():
                program_types.add('major')
            if 'minor' in key.lower():
                program_types.add('minor')
        if not program_types:
            program_types.add('program')

        faculty_names = []
        seen = set()
        for f in faculty.split(','):
            name = normalize_faculty_name(f)
            if name and name not in seen:
                seen.add(name)
                faculty_names.append(name)

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

    output = {
        'catalog_year': '2025-2026',
        'generated_at': '2026-07-27',
        'source_url': 'https://catalog.hanover.edu/#programs',
        'total_programs': len(programs_data),
        'total_courses': len(all_courses_api),
        'programs': programs_data,
    }

    with open('majors.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f'\nWritten majors.json ({len(programs_data)} programs, {len(all_courses_api)} total courses)')


if __name__ == '__main__':
    main()
