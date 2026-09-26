#!/usr/bin/env python3
"""Extract the Core Curriculum / Areas of Competency sections from catalog.hanover.edu.

Pulls the current curriculum (students entering Fall 2026+) from the catalog
homepage:

  * Knowledge Courses: LA, HS, PP, RP, SM, SL, WL
  * Skills Courses: W1, S, W2, CP, QL, HW

For each area it records the authoritative course list (the catalog's
`course-list` blocks) plus a planner-compatible `item` (an `electives` node
scoped by a `from` constraint, with the area's own count rule as an aggregate).

SL is the laboratory/field-study component of SM. It is emitted as its own
requirement so the designation is visible to consumers (course view, filter,
import comparison); SM keeps the merged pool and a `min_from` SL constraint.
AF (Health and Fitness Applied) still applies to students who entered before
Fall 2026, but the current page only summarizes it and points to the registrar,
so its curated pool is carried forward from the previous output.

The registrar's own feed is the more current word on a course's areas, so the
committed `core_corrections.json` overlays it on the parsed pools (a corrected
code's list replaces its parsed membership) before the requirements are built.

It then auto-reports discrepancies against `majors.json`:

  * CCR/ACE codes that do not appear in our scraped catalog (stale data, or
    genuine gaps at the source);
  * codes in our catalog that no CCR/ACE area references (informational — most
    major courses are not distribution courses).

Output: `core_requirements.json`.
"""

import argparse
import json
import os
import re

import requests
from bs4 import BeautifulSoup

from audit_catalog import designations

# Repo root (this script lives in tools/catalog-pipeline/).
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE_URL = 'https://catalog.hanover.edu'
SOURCE_URL = BASE_URL + '#curriculum'
OUTPUT = os.path.join(ROOT, 'core_requirements.json')
MAJORS_JSON = os.path.join(ROOT, 'majors.json')
CORRECTIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'core_corrections.json')

CODE_RE = re.compile(r'^([A-Z][A-Z/]*)\s+(\d{3})\b')


def normalize_code(code):
    return re.sub(r'\s+', ' ', code).strip().upper()


def fetch_html():
    r = requests.get(BASE_URL)
    r.raise_for_status()
    return r.text


def area_patterns():
    # The current curriculum numbers its headings ("1. Literary and Artistic
    # Perspectives (LA) — 2 units...", "6. Health and Wellness (HW) — one
    # course.") and splits the scientific area into "SM courses:" / "SL courses:"
    # sub-headings, so areas are matched by their parenthesized id token (or the
    # sub-heading text) rather than a leading `ID:` prefix.
    return [
        (re.compile(r'\(LA\)'), 'LA', 'Literary and Artistic Perspectives'),
        (re.compile(r'\(HS\)'), 'HS', 'Historical and Social Perspectives'),
        (re.compile(r'\(PP\)'), 'PP', 'Philosophical Perspectives'),
        (re.compile(r'\(RP\)'), 'RP', 'Religious Perspectives'),
        (re.compile(r'^SM courses:'), 'SM', 'Scientific, Mathematical and Algorithmic Methods'),
        (re.compile(r'^SL courses:'), 'SL', 'Scientific Laboratory / Field Study'),
        (re.compile(r'\(WL\)'), 'WL', 'World Languages and Cultures'),
        (re.compile(r'\(AF\)'), 'AF', 'Health and Fitness Applied'),
        (re.compile(r'\(HW\)'), 'HW', 'Health and Wellness'),
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
    # The SM pool includes the SL (lab/field-study) courses — they count toward
    # the 3 units too; `min_from` just enforces that at least one is a lab.
    pool = courses + lab_codes if area_id == 'SM' else courses
    from_scope = {'type': 'from', 'codes': pool}
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
    if area_id in ('PP', 'RP', 'W1', 'W2', 'S', 'CP', 'QL', 'HW'):
        return {'type': 'electives', 'count': 1, 'constraints': [from_scope]}
    if area_id == 'AF':
        return {'type': 'electives', 'count': 2, 'constraints': [from_scope]}
    if area_id == 'SL':
        # SL is SM's laboratory/field-study component. It is emitted as its own
        # requirement so the designation is visible; one SL course satisfies it
        # and also counts toward SM's `min_from` SL constraint.
        return {'type': 'electives', 'count': 1, 'constraints': [from_scope]}
    raise ValueError(f'unknown area {area_id}')


def load_catalog():
    with open(MAJORS_JSON) as f:
        return json.load(f)['catalog']


def augment_from_descriptions(areas, catalog):
    """Merge description-confirmed designations into the parsed area pools.

    The core page's `course-list` blocks are the primary source, but they are
    sometimes incomplete: a course's own description says it satisfies an area
    the page's list omits (the audit's CAT3 "designated, not listed" class —
    e.g. CHE 323/W2, GEO 222/QL, COM 244/S). A *full* designation ("Satisfies
    the W2 ACE") adds the course to that area's pool; a merely "partially
    satisfies" clause does not (an SL course's partial SM membership already
    reaches SM through the SL merge in `build_requirements`)."""
    for code, rec in (catalog or {}).items():
        ccr, ace = designations(rec.get('description', ''), full_only=True)
        for area in ccr | ace:
            entry = areas.get(area)
            if entry is not None and code not in entry['courses']:
                entry['courses'].append(code)
    return areas


def load_core_corrections():
    """The committed registrar-feed corrections, keyed by normalized course code.

    Returns {} when the file is absent, so the step is a no-op on a revision
    that predates it."""
    if not os.path.exists(CORRECTIONS):
        return {}
    with open(CORRECTIONS) as f:
        doc = json.load(f)
    return {normalize_code(code): list(areas or []) for code, areas in (doc.get('corrections') or {}).items()}


def apply_core_corrections(areas, corrections):
    """Overlay the registrar feed's corrected core areas on the parsed pools.

    The core page is sometimes stale: the registrar's own feed tags a course for
    an area the page omits (GER 226/WL, HF 101/HW). A corrected code's list
    *replaces* its parsed membership — removed from every pool, then added to
    the listed ones — so a feed tag wins over the page. Runs before
    `build_requirements`, so an `SL`-only tag still reaches SM through the SL
    merge. Ids naming an area the page didn't produce are skipped."""
    corrections = corrections or {}
    for code, ids in corrections.items():
        code = normalize_code(code)
        for entry in areas.values():
            if code in entry['courses']:
                entry['courses'] = [c for c in entry['courses'] if c != code]
        for area_id in ids:
            entry = areas.get(area_id)
            if entry is not None and code not in entry['courses']:
                entry['courses'].append(code)
    return areas


def report(areas, catalog):
    print('=== Core Curriculum / ACEs vs majors.json catalog ===')
    for area_id in ('LA', 'HS', 'PP', 'RP', 'SM', 'SL', 'WL', 'AF', 'HW', 'W1', 'S', 'W2', 'CP', 'QL'):
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


def load_carried_areas():
    """Prior requirement entries keyed by id, so an area the live page no longer
    lists can be preserved. Returns {} when there is no prior output."""
    if not os.path.exists(OUTPUT):
        return {}
    with open(OUTPUT) as f:
        doc = json.load(f)
    out = {}
    for program in doc.get('programs', []):
        for req in program.get('requirements', []):
            if req.get('id'):
                out[req['id']] = req
    return out


def build_requirements(areas, carried=None):
    carried = carried or {}
    lab_codes = areas.get('SL', {}).get('courses', [])
    requirements = []
    order = ['LA', 'HS', 'PP', 'RP', 'SM', 'SL', 'WL', 'AF', 'HW', 'W1', 'S', 'W2', 'CP', 'QL']
    rules = {
        'LA': '2 units in different disciplines',
        'HS': '2 units in different disciplines',
        'PP': '1 unit',
        'RP': '1 unit',
        'SM': '3 units in different disciplines; at least 1 must be a laboratory/field-study (SL) course',
        'SL': 'at least 1 laboratory/field-study (SL) course (also counts toward SM)',
        'WL': '2-unit sequence in the same language',
        'AF': 'two 0.25 unit courses',
        'HW': 'one course',
        'W1': '1 course',
        'S': '1 course',
        'W2': '1 course',
        'CP': '1 course',
        'QL': '1 course',
    }
    for area_id in order:
        area = areas.get(area_id)
        if not area:
            # AF still applies to students who entered before Fall 2026, but the
            # current page only summarizes it (no course-list); keep the curated
            # entry from the prior output rather than dropping it.
            if area_id == 'AF' and 'AF' in carried:
                requirements.append(carried['AF'])
            continue
        item = build_item(area_id, area['courses'], lab_codes)
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
    augment_from_descriptions(areas, catalog)
    corrections = load_core_corrections()
    apply_core_corrections(areas, corrections)
    if corrections:
        print(f'Applied {len(corrections)} core correction(s) from the registrar feed')
    report(areas, catalog)

    doc = {
        'schema_version': '2.0',
        'source': SOURCE_URL,
        'programs': [
            {
                'id': 'core-curriculum',
                'name': 'Core Curriculum and Areas of Competency',
                'requirements': build_requirements(areas, load_carried_areas()),
            }
        ],
    }
    with open(OUTPUT, 'w') as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(f'\nwrote {OUTPUT}')


if __name__ == '__main__':
    main()
