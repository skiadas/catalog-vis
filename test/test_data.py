#!/usr/bin/env python3
"""Data-integrity checks for the committed data pipeline.

Validates invariants in majors.json (ids, normalized course codes and faculty
names) and the parsed requirements model vocabulary.
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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
    'course_group',
    'any_of',
    'each_of',
    'some_of',
    'electives',
    'custom',
    'pair',
    'level_gate',
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

    assert data['total_programs'] == len(data['programs']) == 54, 'expected 54 programs'

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
    validate_parsed(parsed)

    print(f'OK: {len(data["programs"])} programs, ids unique + derived, codes/faculty normalized')


if __name__ == '__main__':
    main()
