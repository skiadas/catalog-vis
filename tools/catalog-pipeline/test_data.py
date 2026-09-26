#!/usr/bin/env python3
"""Data-integrity checks for the committed data pipeline.

Validates invariants in majors.json (ids, normalized course codes and faculty
names) and the parsed requirements model vocabulary.
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def fail(msg):
    print('FAIL:', msg)
    sys.exit(1)


KNOWN_PREFIXES = {
    'ANTH',
    'ARTD',
    'ARTH',
    'AST',
    'BCH',
    'BIO',
    'BUSN',
    'CHE',
    'CLA',
    'COM',
    'CS',
    'DSCI',
    'ECO',
    'EDU',
    'ENG',
    'ENGR',
    'ENV',
    'FRE',
    'GEO',
    'GER',
    'GNDS',
    'GRE',
    'HIS',
    'HMS',
    'ID',
    'INS',
    'KIP',
    'LAT',
    'MAT',
    'ML',
    'MRS',
    'MUS',
    'NUR',
    'PHI',
    'PHY',
    'PLS',
    'PSY',
    'SMGT',
    'SOC',
    'SPA',
    'THR',
    'THS',
}

NODE_TYPES = {
    'course',
    'any_of',
    'each_of',
    'some_of',
    'electives',
    'custom',
}
CONSTRAINT_TYPES = {'level', 'from', 'exclude', 'discipline', 'max_from', 'min_from', 'note'}
CODE_RE = re.compile(r'^[A-Z/]{2,8} \d{3}(-\d{3})?$')


def validate_parsed(data):
    def walk_items(items):
        for it in items:
            yield it
            if it.get('items'):
                yield from walk_items(it['items'])

    for p in data['programs']:
        for req in p['requirements']:
            if not isinstance(req, dict) or 'sections' not in req:
                fail(f"parsed requirement missing sections: {p['name']} {req}")
            for sec in req['sections']:
                for it in walk_items(sec.get('items', [])):
                    t = it.get('type')
                    if t not in NODE_TYPES:
                        fail(f"unknown item type {t!r} in {p['name']} {req['label']}")
                    if t == 'any_of' and (it.get('codes') is not None) and it.get('items'):
                        fail(f"any_of has both codes and items in {p['name']} {req['label']}")
                    if t == 'each_of' or t == 'some_of':
                        if not it.get('items'):
                            fail(f"{t} missing items in {p['name']} {req['label']}")
                    if it.get('code'):
                        assert_code(it['code'], p, req)
                    for code in it.get('codes', []) or []:
                        assert_code(code, p, req)
                    for c in it.get('constraints', []) or []:
                        ct = c.get('type')
                        if ct not in CONSTRAINT_TYPES:
                            fail(f"unknown constraint type {ct!r} in {p['name']} {req['label']}")
                        if ct == 'discipline':
                            for pfx in c.get('prefixes', []) or []:
                                if pfx not in KNOWN_PREFIXES:
                                    fail(f"unknown discipline prefix {pfx!r} in {p['name']} {req['label']}")
                        if ct in ('from', 'exclude', 'max_from', 'min_from'):
                            for code in c.get('codes', []) or []:
                                assert_code(code, p, req)
                        if ct == 'level':
                            if c.get('level') is None and (c.get('min') is None or c.get('max') is None):
                                fail(f"level constraint needs level or min/max in {p['name']} {req['label']}")
                            if 'comparison' in c:
                                fail(f"legacy level constraint (comparison) in {p['name']} {req['label']}")


def assert_code(code, p, req):
    if not CODE_RE.match(code):
        fail(f"malformed course code {code!r} in {p['name']} {req['label']}")


def main():
    with open(os.path.join(ROOT, 'majors.json'), encoding='utf-8') as f:
        data = json.load(f)

    assert data['total_programs'] == len(data['programs']), 'total_programs must match programs length'

    ids = {}
    for p in data['programs']:
        expected_id = re.sub(r'[^a-zA-Z0-9]', '', p['name'].strip().replace(' ', '')).lower()
        assert isinstance(p['id'], str) and p['id'], f'empty id for {p["name"]}'
        assert p['id'] == expected_id, f'id {p["id"]} not derived from name {p["name"]}'
        assert p['id'] not in ids, f'duplicate id {p["id"]}'
        ids[p['id']] = p

    for p in data['programs']:
        for name in p.get('faculty', []):
            assert isinstance(name, str) and name.strip(), f'empty faculty name in {p["name"]}'
            assert name == name.strip(), f'faculty name not trimmed in {p["name"]}: {name!r}'
            assert not name.endswith('.'), f'faculty name still carries trailing period: {name}'
        for c in p.get('courses', []):
            code = c['course_code']
            assert re.match(r'^[A-Z]{2,4} \d{3}$', code), f'course code not normalized: {code!r}'
        assert isinstance(p.get('requirements'), dict), f'invalid requirements for {p["name"]}'

    no_reqs = [p['name'] for p in data['programs'] if not p['requirements']]
    if no_reqs:
        print(f'NOTE: {len(no_reqs)} program(s) have no parsed requirements: {no_reqs}')

    # Requirements model vocabulary integrity.
    with open(os.path.join(ROOT, 'requirements_parsed.json'), encoding='utf-8') as f:
        parsed = json.load(f)

    # Planner track identity: each parsed requirement's label must slug to a
    # unique track key (within its program), so the planner's label-based track
    # mapping is stable.
    def track_slug(label):
        return re.sub(r'[^a-z0-9]+', '_', str(label or '').lower()).strip('_') or 'track'

    for p in parsed['programs']:
        slugs = [track_slug(req.get('label', '')) for req in p['requirements']]
        dupes = [s for s in slugs if slugs.count(s) > 1]
        assert not dupes, f'duplicate planner track slugs in {p["id"]}: {dupes}'

    validate_parsed(parsed)

    # Cross-listing integrity: every group references catalog courses, is
    # two-or-more strong, and no course belongs to two groups.
    with open(os.path.join(ROOT, 'cross_listings.json'), encoding='utf-8') as f:
        cross = json.load(f)
    assert cross['schema_version'] == '2.0', 'cross_listings.json schema_version must be 2.0'
    catalog_codes = set(data['catalog'])
    seen_codes = {}
    for group in cross['groups']:
        assert isinstance(group.get('id'), str) and group['id'], 'cross-listing group needs an id'
        codes = group.get('codes')
        assert isinstance(codes, list) and len(codes) >= 2, f'group {group.get("id")} needs >= 2 codes'
        assert len(codes) == len(set(codes)), f'duplicate code in group {group["id"]}'
        for code in codes:
            assert code in catalog_codes, f'cross-listed code not in catalog: {code}'
            assert code not in seen_codes, f'{code} appears in two cross-listing groups'
            seen_codes[code] = group['id']
    if cross['groups']:
        print(f'NOTE: {len(cross["groups"])} cross-listing group(s), ' f'{len(seen_codes)} course codes')

    print(f'OK: {len(data["programs"])} programs, ids unique + derived, codes/faculty normalized')


if __name__ == '__main__':
    main()
