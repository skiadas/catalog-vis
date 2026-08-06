#!/usr/bin/env python3
"""Extract the Core Curriculum / Areas of Competency sections from catalog.hanover.edu.

Pulls the two distribution sections from the catalog homepage:

  * Core Curriculum Requirements (CCRs): LA, HS, PP, RP, SM, SL, WL, AF
  * Areas of Competency and Engagement (ACEs): W1, S, W2, CP, QL

For each area it records the authoritative course list (the catalog's
`course-list` blocks) plus a planner-compatible `item` (an `electives` node
scoped by a `from` constraint, with the area's own count rule as an aggregate).

It then auto-reports discrepancies against `majors.json`:

  * CCR/ACE codes that do not appear in our scraped catalog (stale data, or
    genuine gaps at the source);
  * codes in our catalog that no CCR/ACE area references (informational — most
    major courses are not distribution courses).

Output: `core_requirements.json`.
"""

import argparse
import json
import re

import requests
from bs4 import BeautifulSoup

BASE_URL = 'https://catalog.hanover.edu'
SOURCE_URL = BASE_URL + '#curriculum'
OUTPUT = 'core_requirements.json'
MAJORS_JSON = 'majors.json'

CODE_RE = re.compile(r'^([A-Z][A-Z/]*)\s+(\d{3})\b')


def normalize_code(code):
    return re.sub(r'\s+', ' ', code).strip().upper()


def fetch_html():
    r = requests.get(BASE_URL)
    r.raise_for_status()
    return r.text


def area_patterns():
    return [
        (re.compile(r'\(LA\)'), 'LA', 'Literary and Artistic Perspectives'),
        (re.compile(r'\(HS\)'), 'HS', 'Historical and Social Perspectives'),
        (re.compile(r'^PP[:.]'), 'PP', 'Philosophical Perspectives'),
        (re.compile(r'^RP[:.]'), 'RP', 'Religious Perspectives'),
        (re.compile(r'^SM[:.]'), 'SM', 'Scientific and Mathematical Methods'),
        (re.compile(r'^SL[:.]'), 'SL', 'Scientific Laboratory / Field Study'),
        (re.compile(r'\(WL\)'), 'WL', 'World Languages and Cultures'),
        (re.compile(r'\(AF\)'), 'AF', 'Health and Fitness Applied'),
        (re.compile(r'Writing 1 \(W1\)'), 'W1', 'Writing 1'),
        (re.compile(r'Speaking \(S\)'), 'S', 'Speaking'),
        (re.compile(r'Writing 2 \(W2\)'), 'W2', 'Writing 2'),
        (re.compile(r'\(CP\)'), 'CP', 'Cultural Perspectives'),
        (re.compile(r'\(QL\)'), 'QL', 'Quantitative Literacy'),
    ]


def heading_area(heading_text, patterns):
    for pattern, area_id, label in patterns:
        if pattern.search(heading_text):
            return area_id, label
    return None, None


def extract_codes(ul):
    """All course codes in one `course-list` block, department groups unwrapped."""
    codes = []
    for li in ul.find_all('li'):
        if li.find('ul'):
            continue  # department grouping header, not a course
        text = li.get_text(' ', strip=True)
        m = CODE_RE.match(text)
        if m:
            codes.append(normalize_code(f'{m.group(1)} {m.group(2)}'))
    return codes


def parse_areas(html):
    soup = BeautifulSoup(html, 'html.parser')
    patterns = area_patterns()
    areas = {}
    current = None

    for el in soup.find_all(['h3', 'h4', 'ul']):
        if el.name in ('h3', 'h4'):
            text = el.get_text(' ', strip=True)
            area_id, label = heading_area(text, patterns)
            current = area_id or None
        elif el.name == 'ul' and 'course-list' in (el.get('class') or []):
            if current is None:
                raise RuntimeError('course-list block with no preceding area heading')
            areas.setdefault(current, {'label': label, 'courses': []})
            areas[current]['courses'].extend(extract_codes(el))

    # Deduplicate while preserving order (a course can legitimately appear in
    # more than one area; within one area it should not repeat).
    for area_id in areas:
        seen = set()
        unique = []
        for code in areas[area_id]['courses']:
            if code not in seen:
                seen.add(code)
                unique.append(code)
        areas[area_id]['courses'] = unique
    return areas


def build_item(area_id, courses, lab_codes):
    """Planner-compatible `electives` item for a distribution area."""
    from_scope = {'type': 'from', 'codes': courses}
    if area_id in ('LA', 'HS'):
        return {
            'type': 'electives',
            'count': 2,
            'constraints': [from_scope, {'type': 'discipline', 'distinctAtLeast': 2}],
        }
    if area_id == 'SM':
        return {
            'type': 'electives',
            'count': 3,
            'constraints': [
                from_scope,
                {'type': 'discipline', 'distinctAtLeast': 3},
                {'type': 'min_from', 'codes': lab_codes, 'atLeast': 1},
            ],
        }
    if area_id == 'WL':
        return {
            'type': 'electives',
            'count': 2,
            'constraints': [from_scope, {'type': 'discipline', 'sameDiscipline': True}],
        }
    if area_id in ('PP', 'RP', 'W1', 'W2', 'S', 'CP', 'QL'):
        return {'type': 'electives', 'count': 1, 'constraints': [from_scope]}
    if area_id == 'AF':
        return {'type': 'electives', 'count': 2, 'constraints': [from_scope]}
    if area_id == 'SL':
        return None  # SL is a sub-pool of SM, not a standalone requirement
    raise ValueError(f'unknown area {area_id}')


def load_catalog():
    with open(MAJORS_JSON) as f:
        return json.load(f)['catalog']


def report(areas, catalog):
    print('=== Core Curriculum / ACEs vs majors.json catalog ===')
    for area_id in ('LA', 'HS', 'PP', 'RP', 'SM', 'SL', 'WL', 'AF', 'W1', 'S', 'W2', 'CP', 'QL'):
        if area_id not in areas:
            print(f'- {area_id}: MISSING FROM PARSED HTML')
            continue
        courses = areas[area_id]['courses']
        missing = sorted(c for c in courses if c not in catalog)
        status = 'OK' if not missing else f'{len(missing)} missing from catalog'
        print(f'- {area_id}: {len(courses)} courses | {status}')
        for code in missing:
            print(f'    MISSING {code}')
    referenced = set()
    for courses in areas.values():
        referenced.update(courses['courses'])
    unreferenced = sorted(c for c in catalog if c not in referenced)
    print(f'\nCatalog courses referenced by no CCR/ACE area: {len(unreferenced)} of {len(catalog)}')


def build_requirements(areas):
    lab_codes = areas.get('SL', {}).get('courses', [])
    requirements = []
    order = ['LA', 'HS', 'PP', 'RP', 'SM', 'SL', 'WL', 'AF', 'W1', 'S', 'W2', 'CP', 'QL']
    rules = {
        'LA': '2 units in different disciplines',
        'HS': '2 units in different disciplines',
        'PP': '1 unit',
        'RP': '1 unit',
        'SM': '3 units in different disciplines; at least 1 must be a laboratory/field-study (SL) course',
        'SL': 'sub-pool of SM',
        'WL': '2-unit sequence in the same language',
        'AF': 'two 0.25 unit courses',
        'W1': '1 course',
        'S': '1 course',
        'W2': '1 course',
        'CP': '1 course',
        'QL': '1 course',
    }
    for area_id in order:
        area = areas.get(area_id)
        if not area:
            continue
        item = build_item(area_id, area['courses'], lab_codes)
        if item is None:
            continue  # SL is folded into SM (as the min_from lab pool), not a requirement
        # The SM pool includes SL courses — they count toward the 3 units too.
        pool = area['courses'] + lab_codes if area_id == 'SM' else area['courses']
        entry = {
            'id': area_id,
            'label': f'{area["label"]} ({area_id})',
            'rule': rules[area_id],
            'courses': pool,
            'sections': [{'heading': rules[area_id], 'items': [item]}],
        }
        if area_id == 'SM':
            entry['lab_pool'] = lab_codes
        requirements.append(entry)
    return requirements


def main():
    parser = argparse.ArgumentParser(
        description='Extract the core curriculum sections from catalog.hanover.edu'
    )
    parser.add_argument('--html', help='parse a cached HTML file instead of fetching')
    args = parser.parse_args()

    html = fetch_html() if not args.html else open(args.html).read()
    areas = parse_areas(html)
    catalog = load_catalog()
    report(areas, catalog)

    doc = {
        'schema_version': '2.0',
        'source': SOURCE_URL,
        'programs': [
            {
                'id': 'core-curriculum',
                'name': 'Core Curriculum and Areas of Competency',
                'requirements': build_requirements(areas),
            }
        ],
    }
    with open(OUTPUT, 'w') as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(f'\nwrote {OUTPUT}')


if __name__ == '__main__':
    main()
