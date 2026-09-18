"""Build a user-directory CSV from Hanover's public program pages.

One-off companion to the catalog pipeline (not part of the `majors.json`
regeneration): walks https://www.hanover.edu/academics/programs/, opens each
program page, and reads its "Faculty" staff list — full name, email, title.
The email becomes the directory username (local part), the program's
`course_prefix` from `majors.json` becomes a department, and a person listed on
several programs gets the union of their prefixes.

Output lands at the repo root as `directory.csv` and is deliberately **not
committed** (personal contact data); it is meant to be imported through the
admin page's bulk CSV import and pruned there.

Columns: `username,displayName,departments,programs`. The trailing `programs`
column is a review aid — the importer ignores extra columns.

Quirks handled (see the www pages): names may carry a class-year suffix
("Kevin Stormer '04"), the "Faculty" section mixes in staff (CIO, coordinator),
program slugs do not always match catalog ids (cs -> computerscience), and a
handful of grid slugs are pre-professional paths with no catalog program — those
are skipped. Name matching for the cross-check folds punctuation and accents, so
catalog spellings like O’Neill/ONeill and Buckwalter-Arias/Buckwalter do not
read as gaps.

`majors.json`'s per-program faculty lists are cross-checked against the pages
(which are treated as current). A catalog-only person already in the CSV under
another program is reported as such; one who appears nowhere gets a lookup on
their `/about/profiles/<slug>` page for a contact email, so occasional teachers
who are not on a program page (the president, say) are still included. Those
with no profile email are listed for a manual add.
"""

import argparse
import csv
import json
import os
import re
import sys
import time
import unicodedata

import requests
from bs4 import BeautifulSoup

# Repo root (this script lives in tools/catalog-pipeline/).
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PROGRAMS_URL = 'https://www.hanover.edu/academics/programs/'
# Pause between requests to the www host to avoid flooding it.
REQUEST_DELAY = 1.0

# www program slug -> catalog program id (majors.json `id`), whose
# `course_prefix` supplies the directory department. Slugs absent here are
# skipped on purpose: designyourmajor and the pre-professional paths
# (accounting, healthsciences, prelaw, premed) and sustainability have no
# catalog program to borrow a prefix from.
SLUG_TO_PROGRAM = {
    'anthropology': 'anthropologycultural',
    'art': 'artanddesign',
    'arthistory': 'arthistory',
    'biochemistry': 'biochemistry',
    'biology': 'biology',
    'business': 'business',
    'chemistry': 'chemistry',
    'classics': 'classicalstudies',
    'communication': 'communication',
    'cs': 'computerscience',
    'datascience': 'datascience',
    'economics': 'economics',
    'education': 'education',
    'engineering': 'engineering',
    'english': 'english',
    'environmentalscience': 'environmentalscience',
    'french': 'french',
    'genderstudies': 'genderstudies',
    'geology': 'geology',
    'german': 'german',
    'healthmovementstudies': 'healthandmovementstudies',
    'history': 'history',
    'internationalstudies': 'internationalstudies',
    'kinesiology': 'kinesiologyandintegrativephysiology',
    'latin': 'latin',
    'math': 'mathematics',
    'medievalrenaissance': 'medievalrenaissancestudies',
    'music': 'music',
    'nursing': 'nursing',
    'philosophy': 'philosophy',
    'physics': 'physics',
    'political': 'politicalscience',
    'psychology': 'psychology',
    'sociology': 'sociology',
    'spanish': 'spanish',
    'sportsmanagement': 'sportsmanagement',
    'theatre': 'theatre',
    'theological': 'theologicalstudies',
}

# Trim non-faculty titles when reporting (a person is still kept).
FACULTY_TITLE = re.compile(r'professor|instructor|lecturer|faculty', re.IGNORECASE)
# A name's class-year marker, e.g. "Kevin Stormer '04" or "... 04".
CLASS_YEAR = re.compile(r"\s+'?\d{2}$")


def clean_name(name):
    """Collapse whitespace and drop a trailing class-year marker."""
    name = re.sub(r'\s+', ' ', (name or '')).strip()
    return CLASS_YEAR.sub('', name).strip()


def fetch(url):
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.text


def load_prefixes():
    """catalog program id -> course_prefix, from the committed majors.json."""
    with open(os.path.join(ROOT, 'majors.json'), encoding='utf-8') as f:
        data = json.load(f)
    return {p['id']: p.get('course_prefix') or '' for p in data['programs']}


def extract_program_slugs(html):
    """The program slugs linked from the index, in page order, deduped."""
    soup = BeautifulSoup(html, 'html.parser')
    slugs = []
    seen = set()
    for a in soup.select('a[href*="/academics/programs/"]'):
        href = a.get('href') or ''
        tail = href.split('/academics/programs/', 1)[-1]
        slug = tail.strip('/').split('/')[0].split('#')[0].split('?')[0]
        if slug and slug not in seen:
            seen.add(slug)
            slugs.append(slug)
    return slugs


def parse_faculty(html):
    """The `.staff-member` entries under the page's faculty section."""
    soup = BeautifulSoup(html, 'html.parser')
    people = []
    for member in soup.select('div.staff-directory div.staff-member'):
        name_el = member.select_one('.staff-name')
        title_el = member.select_one('.staff-title')
        email_el = member.select_one('.staff-email a[href^="mailto:"]')
        if email_el is None:
            email_el = member.select_one('.staff-email')
        email = ''
        if email_el is not None:
            href = email_el.get('href') or ''
            email = href[len('mailto:') :] if href.startswith('mailto:') else email_el.get_text()
        people.append(
            {
                'name': clean_name(name_el.get_text() if name_el else ''),
                'email': re.sub(r'\s+', '', email or '').lower(),
                'title': re.sub(r'\s+', ' ', title_el.get_text() if title_el else '').strip(),
            }
        )
    return people


def local_part(email):
    return email.split('@', 1)[0] if email else ''


def build_rows(entries):
    """entries: [{slug, program, prefix, person}] -> CSV rows by username."""
    people = {}
    for entry in entries:
        person = entry['person']
        username = local_part(person['email'])
        if not username:
            continue
        row = people.get(username)
        if row is None:
            row = {
                'username': username,
                'displayName': person['name'],
                'email': person['email'],
                'departments': [],
                'programs': [],
                'titles': [],
            }
            people[username] = row
        if not row['displayName']:
            row['displayName'] = person['name']
        for value, bucket in ((entry['prefix'], row['departments']), (entry['program'], row['programs'])):
            if value and value not in bucket:
                bucket.append(value)
        if person['title'] and person['title'] not in row['titles']:
            row['titles'].append(person['title'])
    return [people[u] for u in sorted(people)]


def name_tokens(name):
    """Comparable name tokens: punctuation dropped (so O’Neill == ONeill, and
    Buckwalter-Arias keeps both surnames), accents folded, lowercased."""
    folded = unicodedata.normalize('NFKD', name or '').encode('ascii', 'ignore').decode()
    folded = folded.replace("'", '').replace('’', '')
    return [t for t in re.split(r'[^a-z0-9]+', folded.lower()) if t]


def name_matches(catalog_name, person_name):
    """True when a catalog name and a page name likely denote the same person:
    a shared token of two or more characters covers initials, extra surnames,
    short surnames (Wu), and the O’Neill/ONeill and Buckwalter-Arias/Buckwalter
    spelling splits. Single letters are initials and don't count."""
    a, b = set(name_tokens(catalog_name)), set(name_tokens(person_name))
    return bool({t for t in a & b if len(t) >= 2})


def find_row(rows, name):
    """The CSV row whose display name matches a catalog name, or None."""
    for row in rows:
        if name_matches(name, row['displayName']):
            return row
    return None


def catalog_only_names(catalog_faculty, entries):
    """(program, catalog_name) pairs the catalog lists but whose www page does
    not — the cross-check's raw findings, before any categorization."""
    by_program = {}
    for entry in entries:
        by_program.setdefault(entry['program'], []).append(entry['person']['name'])
    out = []
    for program, names in sorted(catalog_faculty.items()):
        page_names = by_program.get(program)
        if page_names is None:
            continue  # program not fetched (its slug was skipped)
        for name in names:
            if not any(name_matches(name, pn) for pn in page_names):
                out.append((program, name))
    return out


def profile_slugs(name):
    """Candidate /about/profiles/<slug> slugs from a catalog name."""
    tokens = name_tokens(name)
    if not tokens:
        return []
    slugs = [tokens[-1]]
    if len(tokens) > 1:
        slugs.append(tokens[0] + tokens[-1])
    return sorted({s for s in slugs if len(s) >= 3})


def clean_profile_name(title):
    """'Lake Lambert, Ph.D. - Hanover College' -> 'Lake Lambert'."""
    name = re.sub(r'\s*[-–]\s*Hanover College\s*$', '', title or '', flags=re.IGNORECASE)
    name = re.sub(
        r',?\s*(Ph\.?\s*D|Ed\.?\s*D|M\.?\s*D|J\.?\s*D|D\.?\s*B\.?\s*A)\.?.*$', '', name, flags=re.IGNORECASE
    )
    return re.sub(r'\s+', ' ', name).strip()


def resolve_profile(name, delay):
    """Try the person's profile page for a contact email. Returns a person dict
    ({name, email, title}) or None — used for catalog-only people who teach but
    are not listed on any program page (e.g. the president)."""
    for slug in profile_slugs(name):
        url = f'https://www.hanover.edu/about/profiles/{slug}/'
        try:
            r = requests.get(url, timeout=30)
        except requests.RequestException:
            continue
        if r.status_code != 200:
            continue
        emails = re.findall(r'[A-Za-z0-9._%+-]+@hanover\.edu', r.text)
        if not emails:
            continue
        title_el = BeautifulSoup(r.text, 'html.parser').select_one('title')
        display = clean_profile_name(title_el.get_text(' ', strip=True) if title_el else '')
        time.sleep(delay)
        return {'name': display or name, 'email': emails[0].lower(), 'title': ''}
    return None


def report(rows, skipped, present, added, unresolved):
    """Print the review notes that do not belong in the CSV."""
    print('\n== Review notes ==')
    multi = [r for r in rows if len(r['programs']) > 1]
    print(f"\nOn multiple programs ({len(multi)}):")
    for r in multi:
        print(f"  {r['displayName']} <{r['username']}>: {', '.join(r['programs'])}")

    non_faculty = [r for r in rows if not all(FACULTY_TITLE.search(t) for t in r['titles'])]
    print(f"\nNon-faculty titles kept ({len(non_faculty)}):")
    for r in non_faculty:
        print(f"  {r['displayName']} <{r['username']}>: {', '.join(r['titles'])}")

    off_domain = [r for r in rows if not r['email'].endswith('@hanover.edu')]
    if off_domain:
        print(f"\nNon-hanover.edu addresses ({len(off_domain)}):")
        for r in off_domain:
            print(f"  {r['displayName']} <{r['email']}>")

    # The catalog's per-program faculty lists can be stale or over-broad (they
    # put every art faculty member under both art programs, say); the www page
    # is treated as current. Names its page lacks fall into three buckets.
    print('\nCatalog-only names (majors.json lists them for a program whose www page does not):')
    if present:
        print('  already in the CSV under another program (add the prefix if still true):')
        for program, name, row in present:
            print(f"    {program}: {name} -> {row['displayName']} ({', '.join(row['departments'])})")
    if added:
        print('  added from the person\'s profile page (email found there):')
        for program, name, person in added:
            print(f"    {program}: {name} -> {person['name']} <{local_part(person['email'])}>")
    if unresolved:
        print('  not in the CSV and no profile email found — add by hand if still current:')
        for program, name in unresolved:
            print(f"    {program}: {name}")

    empty = sorted({s for s in skipped})
    if empty:
        print(f"\nSkipped slugs (no catalog program): {', '.join(empty)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--output', default=os.path.join(ROOT, 'directory.csv'))
    ap.add_argument('--limit', type=int, default=0, help='debug: only the first N programs')
    ap.add_argument('--delay', type=float, default=REQUEST_DELAY)
    ap.add_argument(
        '--no-profiles',
        action='store_true',
        help='skip resolving catalog-only people via their profile pages',
    )
    args = ap.parse_args()

    prefixes = load_prefixes()
    print(f'Fetching {PROGRAMS_URL}')
    slugs = extract_program_slugs(fetch(PROGRAMS_URL))
    print(f'  {len(slugs)} program links found')
    if args.limit:
        slugs = slugs[: args.limit]

    entries = []
    skipped = []
    fetched = []
    for slug in slugs:
        program = SLUG_TO_PROGRAM.get(slug)
        if not program or program not in prefixes:
            skipped.append(slug)
            continue
        prefix = prefixes[program]
        print(f'  {slug:26s} -> {program:34s} {prefix}')
        people = parse_faculty(fetch(f'https://www.hanover.edu/academics/programs/{slug}'))
        if not people:
            print(f'    (no faculty section)')
        for person in people:
            entries.append({'slug': slug, 'program': program, 'prefix': prefix, 'person': person})
        fetched.append(slug)
        time.sleep(args.delay)

    with open(os.path.join(ROOT, 'majors.json'), encoding='utf-8') as f:
        programs = json.load(f)['programs']
    catalog_faculty = {p['id']: p.get('faculty') or [] for p in programs}

    # Cross-check: catalog names the fetched program pages do not list.
    rows = build_rows(entries)
    present = []
    unresolved = []
    added = []
    for program, name in catalog_only_names(catalog_faculty, entries):
        row = find_row(rows, name)
        if row is not None:
            present.append((program, name, row))
            continue
        person = None if args.no_profiles else resolve_profile(name, args.delay)
        if person is None:
            unresolved.append((program, name))
            continue
        entries.append({'slug': None, 'program': program, 'prefix': prefixes[program], 'person': person})
        added.append((program, name, person))
    rows = build_rows(entries)

    with open(args.output, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f, lineterminator='\n')
        writer.writerow(['username', 'displayName', 'departments', 'programs'])
        for r in rows:
            writer.writerow(
                [r['username'], r['displayName'], ', '.join(r['departments']), '; '.join(r['programs'])]
            )

    print(f'\nWrote {args.output}: {len(rows)} accounts from {len(fetched)} programs')
    report(rows, skipped, present, added, unresolved)


if __name__ == '__main__':
    try:
        main()
    except requests.RequestException as err:
        sys.exit(f'Fetch failed: {err}')
