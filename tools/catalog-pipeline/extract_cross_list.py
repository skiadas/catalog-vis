#!/usr/bin/env python3
"""Extract cross-listed course groups from catalog descriptions.

The scraped catalog carries no structured cross-listing field; the relationship
is stated in course prose, e.g.

    "Identical to ENGR 263 and PHI 263."
    "Identical to Classics 251."
    "Identical to ANTH223/ARTH223/SOC223."

This step parses those statements out of `majors.json`, normalizes the target
codes (case; the `CLASSICS -> CLA` and `ART -> ARTD` aliases), resolves them
against the scraped catalog, drops self-references and targets the catalog does
not carry, and unions the pairs into connected groups.

Only courses that are actually cross-listed with at least one other catalog
course appear, so every emitted group has two or more members that all exist in
`majors.json`.

Output: `cross_listings.json`. Consumed by the schedule app (to group offerings
that are cross-listed and keep them identical) and validated by the catalog
contract (`packages/catalog-contract/schemas/cross_listings.schema.json`).
"""

import argparse
import json
import os
import re

# Repo root (this script lives in tools/catalog-pipeline/).
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

MAJORS_JSON = os.path.join(ROOT, 'majors.json')
OUTPUT = os.path.join(ROOT, 'cross_listings.json')

SOURCE = 'https://catalog.hanover.edu#programs (derived from course descriptions)'

# Prefix spellings that appear in prose but are not catalog prefixes.
PREFIX_ALIASES = {
    'CLASSICS': 'CLA',
    'ART': 'ARTD',
}

# "identical to" plus the rest of the sentence; a target code is a prefix token
# followed by a 3-digit number (optionally letter-suffixed), tolerating the
# missing space the catalog frequently uses ("CLA225", "ANTH223/ARTH223").
PHRASE_RE = re.compile(r'identical to\s+([^.]*)', re.IGNORECASE)
CODE_RE = re.compile(r'([A-Za-z]+)\s*(\d{3}[A-Za-z]?)')
CATALOG_CODE_RE = re.compile(r'^([A-Z]{2,6})\s+(\d{3})$')


def normalize_code(prefix, number):
    """A prose `(prefix, number)` pair to a catalog code, applying aliases."""
    return f'{PREFIX_ALIASES.get(prefix.upper(), prefix.upper())} {number.upper()}'


def targets_in(description):
    """Every catalog-looking code named by an "identical to" phrase."""
    out = []
    for match in PHRASE_RE.finditer(description or ''):
        for prefix, number in CODE_RE.findall(match.group(1)):
            out.append(normalize_code(prefix, number))
    return out


def find_groups(catalog):
    """Union course codes into connected groups via the description pairs."""
    codes = set(catalog)
    parent = {code: code for code in codes}

    def find(code):
        while parent[code] != code:
            parent[code] = parent[parent[code]]
            code = parent[code]
        return code

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    unresolved = {}
    for code, record in catalog.items():
        for target in targets_in(record.get('description')):
            if target == code:
                continue
            if target not in codes:
                unresolved[target] = unresolved.get(target, 0) + 1
                continue
            union(code, target)

    components = {}
    for code in codes:
        components.setdefault(find(code), []).append(code)

    groups = []
    for members in components.values():
        if len(members) < 2:
            continue
        members = sorted(members)
        slug = '-'.join(m.lower().replace(' ', '-') for m in members)
        groups.append({'id': slug, 'codes': members})
    groups.sort(key=lambda g: g['id'])
    return groups, unresolved


def load_catalog():
    with open(MAJORS_JSON, encoding='utf-8') as f:
        return json.load(f)


def report(groups, unresolved, catalog):
    print('=== Cross-listings (from course descriptions) ===')
    for group in groups:
        names = [catalog[c].get('course_name', '') for c in group['codes']]
        print(f"- {' / '.join(group['codes'])}")
        for code, name in zip(group['codes'], names):
            print(f'    {code}: {name}')
    print(f'\n{len(groups)} group(s), {sum(len(g["codes"]) for g in groups)} course codes')
    if unresolved:
        print('\nTargets named but not in the catalog (dropped):')
        for code, count in sorted(unresolved.items()):
            print(f'  {code} (x{count})')
    # These shapes are generic repeatable courses that merely share a
    # description; they are not phrase-linked and must NOT be grouped.
    print('\n(Only "identical to" prose is used; title/description twins like')
    print(' "Special Topics"/"Directed Study" are deliberately not grouped.)')


def main():
    parser = argparse.ArgumentParser(
        description='Extract cross-listed course groups from majors.json descriptions'
    )
    parser.add_argument('--check', action='store_true', help='report only; do not write')
    args = parser.parse_args()

    majors = load_catalog()
    catalog = majors['catalog']
    groups, unresolved = find_groups(catalog)
    report(groups, unresolved, catalog)

    # Defensive: every emitted code must be a normalized catalog code.
    for group in groups:
        for code in group['codes']:
            if not CATALOG_CODE_RE.match(code):
                raise SystemExit(f'non-catalog code in a group: {code!r}')

    if args.check:
        return

    doc = {
        'schema_version': '2.0',
        'source': SOURCE,
        'groups': groups,
    }
    with open(OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(f'\nwrote {OUTPUT}')


if __name__ == '__main__':
    main()
