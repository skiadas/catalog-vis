#!/usr/bin/env python3
"""Data-integrity checks for the committed data pipeline.

Validates invariants in majors.json (ids, normalized course codes and faculty
names) and confirms the schedule generator is deterministic (matches the
committed sample-schedule.csv under the fixed seed).
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def fail(msg):
    print('FAIL:', msg)
    sys.exit(1)


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

    # Schedule generator must be deterministic under seed 42.
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copy(os.path.join(ROOT, 'majors.json'), os.path.join(tmp, 'majors.json'))
        shutil.copy(os.path.join(ROOT, 'generate_schedule.py'), tmp)
        subprocess.run([sys.executable, 'generate_schedule.py'], cwd=tmp, check=True)
        with open(os.path.join(tmp, 'sample-schedule.csv'), encoding='utf-8') as f:
            regenerated = f.read()
    with open(os.path.join(ROOT, 'sample-schedule.csv'), encoding='utf-8') as f:
        committed = f.read()
    assert regenerated == committed, 'generate_schedule.py no longer matches committed CSV'

    print(
        f'OK: {len(data["programs"])} programs, ids unique + derived, codes/faculty normalized, schedule deterministic'
    )


if __name__ == '__main__':
    main()
