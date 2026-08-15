#!/usr/bin/env python3
"""Cross-check our scraped catalog for the four issue classes the curriculum team
tracks, and store the results for triage.

Scans `majors.json` (per-program course lists, the global `catalog` index, and
the raw requirement texts) plus `core_requirements.json` (the parsed CCR/ACE
distribution areas) and reports discrepancies as typed rows:

   1. CAT1  modeled but not indexed: a course appears in a program's `courses`
            list but is missing from the global `catalog` dict. Auto-backfill.
   2. CAT2  listed, not designated: a course is listed in a CCR/ACE area pool
            but its own description does not carry that area's designation.
            Requires human confirmation.
   3. CAT3  designated, not listed: a course whose description claims a CCR/ACE
            area does not appear in that area's list.
   4. CAT4  required but unmodeled: a requirement (core or major) references a
            course number for which our data has no description at all.
   5. CAT5  source disagreement: the Course Search (`get_courses`) and program
            page (`get_program_courses_file`) endpoints describe a course
            differently. Carries a `similarity` score and `severity` bucket
            (major/moderate/minor/trivial); rows sort by largest disagreement.
            Report to the catalog admins.
   6. CAT6  designation-verb typo: "Satisfies"/"fulfills" is misspelled in a
            description, hiding a CCR/ACE designation. Report to the catalog
            admins.
   7. CAT7  presence disagreement: a course appears in exactly one of the two
            sources — `search-only` (in Course Search, no program page) or
            `program-only` (on a program page, not in Course Search). Report to
            the catalog admins.

Cross-listing is resolved the same way the planner does: slash codes
(`ENG/COM 251` -> `ENG 251` / `COM 251`), the `GNDR -> GNDS` prefix alias, and
numeric ranges (`ENV 408-409` -> `ENV 408`, `ENV 409`). A code "has a
description" iff any concrete spelling resolves in the union of the API catalog
and the per-program course lists.

Writes `catalog_issues.json` (typed rows) and `catalog_issues.md` (a readable
table for triage).
"""

import argparse
import difflib
import json
import os
import re

# Repo root (this script lives in tools/catalog-pipeline/).
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

MAJORS_JSON = os.path.join(ROOT, 'majors.json')
CORE_JSON = os.path.join(ROOT, 'core_requirements.json')
PARSED_JSON = os.path.join(ROOT, 'requirements_parsed.json')
ISSUES_JSON = os.path.join(ROOT, 'catalog_issues.json')
ISSUES_MD = os.path.join(ROOT, 'catalog_issues.md')

CCR_AREAS = ['LA', 'HS', 'PP', 'RP', 'SM', 'SL', 'WL', 'AF']
ACE_AREAS = ['W1', 'W2', 'S', 'CP', 'QL']
# Requirement areas that appear in `core_requirements.json` as pools. SL is a
# sub-pool of SM so it is folded into the SM pool, not an area of its own.
AREA_KEYS = ['LA', 'HS', 'PP', 'RP', 'SM', 'WL', 'AF', 'W1', 'S', 'W2', 'CP', 'QL']


def normalize_code(code):
    return re.sub(r'\s+', ' ', code).strip().upper()


def concrete_spellings(code):
    """Every concrete catalog spelling a requirement code can resolve to."""
    code = normalize_code(code).replace('GNDR', 'GNDS')
    pre, _, num = code.partition(' ')
    if not num:
        return [code]
    if '/' in pre:
        return sorted({f'{p} {num}' for p in pre.split('/')} | {code})
    if re.fullmatch(r'\d{3}-\d{3}', num):
        lo, hi = map(int, num.split('-'))
        return sorted({f'{pre} {n}' for n in range(lo, hi + 1)} | {code})
    return [code]


def is_known(code, known):
    return any(c in known for c in concrete_spellings(code))


# A designation is a known CCR/ACE area code claimed by a description. The area
# codes are known up front (CCR_AREAS + ACE_AREAS), so a designation is found by
# scanning for those tokens directly rather than requiring them to be adjacent
# to "CCR"/"ACE" — that adjacency rule misses elided multi-area lists like
# "satisfies W1 and CP ACE" or "the LA and HS CCRs". A token only counts when its
# preceding clause carries a designation verb ("Satisfies", "Partially
# satisfies", "fulfills", "counts as"), so prerequisite prose ("Completion of W1
# ACE before taking…") is never misread. The verb guard is typo-tolerant (edit
# distance 1) so misspellings like "Satiafies" still count — and are reported as
# CAT6.
DESIGNATION_VERBS = ('satisf', 'fulfill')
VERB_FORMS = (
    'satisfies',
    'satisfy',
    'satisfied',
    'satisfying',
    'fulfills',
    'fulfill',
    'fulfilled',
    'fulfilling',
)
COUNT_RE = re.compile(r'\bcount(?:s|ed|ing)?\b')
# "counts as 0.25 credit toward the AF CCR requirement" is a designation too.
AREA_TOKEN_RE = re.compile(r'\b(' + '|'.join(sorted(CCR_AREAS + ACE_AREAS, key=len, reverse=True)) + r')\b')
_NEGATED_VERB = re.compile(
    r'\b(?:does\s+not|doesn.?t|never|not)\b\s+(?:\w+\s+){0,2}(?:satisf\w*|fulfill\w*|counts?|counted|counting)\b',
    re.IGNORECASE,
)


def _levenshtein(a, b):
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _verb_hits(window):
    """The designation verbs (or distance-1 misspellings) inside a window."""
    low = window.lower()
    hits = set()
    for v in DESIGNATION_VERBS:
        if v in low:
            hits.add(v)
    if COUNT_RE.search(low):
        hits.add('count')
    for word in re.findall(r'[a-z]{5,}', low):
        if any(v in word for v in DESIGNATION_VERBS):
            continue
        for form in VERB_FORMS:
            if _levenshtein(word, form) == 1:
                hits.add(form)
                break
    return hits


def _sentence_boundary(text, pos):
    """The last sentence-ending punctuation at or before `pos` (skips decimals)."""
    for i in range(pos - 1, -1, -1):
        ch = text[i]
        if ch in '\n;!?':
            return i
        if ch == '.':
            if i - 1 >= 0 and i + 1 < len(text) and text[i - 1].isdigit() and text[i + 1].isdigit():
                continue
            return i
    return -1


def _designation_window(text, pos, limit=80):
    """The clause text just before an area-code token, capped at `limit`."""
    clause = _sentence_boundary(text, pos) + 1
    return text[max(clause, pos - limit) : pos]


def designations(desc):
    """The CCR/ACE areas a course description claims to satisfy."""
    ccr, ace = set(), set()
    d = desc or ''
    for m in AREA_TOKEN_RE.finditer(d):
        area = m.group(1)
        window = _designation_window(d, m.start())
        if not _verb_hits(window) or _NEGATED_VERB.search(window):
            continue
        if area in CCR_AREAS:
            ccr.add(area)
        else:
            ace.add(area)
    return ccr, ace


def verb_typos(text):
    """Misspelled designation verbs, as (word, corrected_form) pairs."""
    low = (text or '').lower()
    out = []
    for word in re.findall(r'[a-z]{5,}', low):
        if any(v in word for v in DESIGNATION_VERBS):
            continue
        for form in VERB_FORMS:
            if _levenshtein(word, form) == 1:
                out.append((word, form))
                break
    return out


def load_core_reqs():
    with open(CORE_JSON) as f:
        return json.load(f)['programs'][0]['requirements']


def build_index(majors):
    """Known spellings (catalog keys + per-program lists) and title map."""
    known = set()
    titles = {}
    for code in majors['catalog']:
        known.add(code)
        titles.setdefault(code, majors['catalog'][code].get('course_name', ''))
    for p in majors['programs']:
        for c in p.get('courses') or []:
            co = c['course_code']
            known.add(co)
            titles.setdefault(co, c.get('course_name', ''))
    return known, titles


def titled_or(code, titles):
    t = title_of(code, titles)
    return t if t else code


def similarity(a, b):
    """How similar two description strings are, 0 (different) to 1 (identical)."""
    return round(difflib.SequenceMatcher(None, a or '', b or '').ratio(), 3)


def severity(sim):
    """Coarse triage label for a source-disagreement similarity score."""
    if sim < 0.5:
        return 'major'
    if sim < 0.85:
        return 'moderate'
    if sim < 0.97:
        return 'minor'
    return 'trivial'


def title_of(code, titles):
    for sp in concrete_spellings(code):
        if sp in titles:
            return titles[sp]
    return ''


def audit(majors, core_reqs):
    known, titles = build_index(majors)
    catalog_keys = set(majors['catalog'])

    # --- Category 1: in a program list but missing from the global index
    cat1 = []
    for p in majors['programs']:
        for c in p.get('courses') or []:
            co = c['course_code']
            if co not in catalog_keys:
                cat1.append({'code': co, 'title': c.get('course_name', ''), 'program': p.get('name', '')})
    cat1 = sorted(cat1, key=lambda r: r['code'])

    # --- core area pools (SM includes its SL lab sub-pool)
    raw = {r['id']: set(r['courses']) for r in core_reqs}
    lab = set(next((r.get('lab_pool', []) for r in core_reqs if r['id'] == 'SM'), []))
    pools = {a: raw[a] for a in raw}
    pools['SM'] = raw['SM'] | lab

    # --- per-code designations across the whole catalog
    ccr_desig = {a: set() for a in CCR_AREAS}
    ace_desig = {a: set() for a in ACE_AREAS}
    desig_of = {}
    typos = {}
    for code in majors['catalog']:
        desc = majors['catalog'][code].get('description', '')
        ccr, ace = designations(desc)
        desig_of[code] = (ccr, ace)
        for a in ccr:
            ccr_desig[a].add(code)
        for a in ace:
            ace_desig[a].add(code)
        t = verb_typos(desc)
        if t:
            typos[code] = t

    # --- Category 2: in a pool but the description doesn't designate it
    cat2 = []
    for area, pool in pools.items():
        for code in sorted(pool):
            if code in desig_of:
                ccr, ace = desig_of[code]
                if area not in ccr and area not in ace:
                    cat2.append(
                        {
                            'area': area,
                            'code': code,
                            'title': titled_or(code, titles),
                            'designated': ','.join(sorted(ccr | ace)) or 'none',
                        }
                    )

    # --- Category 3: designated but not present in that area's pool
    # SL courses belong to the SM pool (SL is SM's lab sub-pool).
    cat3 = []
    for area in CCR_AREAS + ACE_AREAS:
        pool = pools['SM'] if area == 'SL' else pools.get(area, set())
        for code in sorted(ccr_desig.get(area, set()) | ace_desig.get(area, set())):
            if code not in pool:
                cat3.append({'area': area, 'code': code})

    # --- Category 4: requirement references a number with no description
    # Sources: the core area pools, the codified major requirements
    # (`requirements_parsed.json`), and the raw requirement texts. Exclusion and
    # cap (`exclude`/`max_from`) codes are not requirements, so they are ignored.
    cat4 = []
    seen4 = set()
    for area, pool in pools.items():
        for code in sorted(pool):
            if not is_known(code, known) and code not in seen4:
                seen4.add(code)
                cat4.append({'kind': 'core', 'area': area, 'code': code})
    if os.path.exists(PARSED_JSON):
        with open(PARSED_JSON) as f:
            parsed = json.load(f)
        for p in parsed['programs']:
            for req in p['requirements']:
                for s in req.get('sections') or []:
                    for code in coded_codes(s.get('items') or []):
                        if not is_known(code, known) and code not in seen4:
                            seen4.add(code)
                            cat4.append({'kind': 'major', 'program': p.get('name', ''), 'code': code})
    for p in majors['programs']:
        for req in (p.get('requirements') or {}).values():
            for code in extract_codes(req.get('text', '')):
                if not is_known(code, known) and code not in seen4:
                    seen4.add(code)
                    cat4.append({'kind': 'major', 'program': p.get('name', ''), 'code': code})
    cat4 = sorted(cat4, key=lambda r: (r['code'], r['kind']))

    # --- Category 5: the two endpoint sources describe the same course differently.
    # Recorded at scrape time in majors.json `source_discrepancies`; surfaced here
    # so the curriculum team can report the disagreement to the catalog admins.
    # A `similarity` score (0-1) measures how far the two texts diverge and a
    # `severity` label buckets it; rows sort by biggest disagreement first.
    cat5 = []
    seen5 = set()
    for d in majors.get('source_discrepancies') or []:
        code = normalize_code(d.get('code', ''))
        if not code or code in seen5:
            continue
        seen5.add(code)
        search = d.get('search_description', '')
        program = d.get('program_description', '')
        sim = similarity(search, program)
        cat5.append(
            {
                'code': code,
                'program': d.get('program', ''),
                'title': titled_or(code, titles),
                'similarity': sim,
                'severity': severity(sim),
                'search_description': search,
                'program_description': program,
            }
        )
    cat5 = sorted(cat5, key=lambda r: r['similarity'])

    # --- Category 6: misspelled designation verb (e.g. "Satiafies")
    cat6 = []
    for code in sorted(typos):
        for word, form in typos[code]:
            cat6.append({'code': code, 'title': titled_or(code, titles), 'typo': word, 'corrected': form})
    cat6 = sorted(cat6, key=lambda r: r['code'])

    # --- Category 7: present in one source but not the other. The Course Search
    # endpoint knows `search-only` codes that appear on no program page, and
    # `program-only` codes sit on a program page but are missing from Course
    # Search. Recorded at scrape time in majors.json `presence_discrepancies`.
    cat7 = []
    seen7 = set()
    for d in majors.get('presence_discrepancies') or []:
        code = normalize_code(d.get('code', ''))
        if not code or code in seen7:
            continue
        seen7.add(code)
        cat7.append(
            {
                'code': code,
                'side': d.get('side', ''),
                'program': d.get('program', ''),
                'title': titled_or(code, titles) or d.get('title', ''),
            }
        )
    cat7 = sorted(cat7, key=lambda r: (r['code'], r['side']))

    return cat1, cat2, cat3, cat4, cat5, cat6, cat7


def coded_codes(items):
    """Required course codes from a codified requirement subtree.

    Includes `course` nodes and `codes` on `any_of`/`each_of`/`some_of` nodes and
    on `electives` `from`/`min_from` constraints. `exclude`/`max_from` are the
    opposite (things that must NOT count) so they are excluded.
    """
    out = set()
    for it in items:
        t = it.get('type')
        if t == 'course':
            out.add(it.get('code'))
        elif t in ('any_of', 'each_of', 'some_of'):
            out.update(it.get('codes') or [])
            out |= coded_codes(it.get('items') or [])
        elif t == 'electives':
            for c in it.get('constraints') or []:
                if c.get('type') in ('from', 'min_from'):
                    out.update(c.get('codes') or [])
    return out


def extract_codes(text):
    """Course codes referenced in a requirement's raw text."""
    return re.findall(r'(?<![A-Z/])[A-Z][A-Z/]{1,5}\s+\d{3}(?:-\d{3})?\b', text or '')


def render_json(cat1, cat2, cat3, cat4, cat5, cat6, cat7):
    return {
        'generated': {'majors': MAJORS_JSON, 'core': CORE_JSON},
        'categories': {
            '1_modeled_not_indexed': [{'category': 1, **r} for r in cat1],
            '2_listed_not_designated': [{'category': 2, **r} for r in cat2],
            '3_designated_not_listed': [{'category': 3, **r} for r in cat3],
            '4_required_unmodeled': [{'category': 4, **r} for r in cat4],
            '5_source_disagreement': [{'category': 5, **r} for r in cat5],
            '6_designation_typo': [{'category': 6, **r} for r in cat6],
            '7_presence_disagreement': [{'category': 7, **r} for r in cat7],
        },
    }


def render_md(cat1, cat2, cat3, cat4, cat5, cat6, cat7):
    lines = ['# Catalog Data Issues', '']
    lines.append('Regenerated by `audit_catalog.py` from `majors.json` and `core_requirements.json`.')
    lines.append('')
    lines.append('| Category | Description | Count | Action |')
    lines.append('|-|-|-|-|')
    lines.append(f'| 1 | In program list but not in the global catalog index | {len(cat1)} | Backfill |')
    lines.append(f'| 2 | Listed as fulfilling an area; description lacks it | {len(cat2)} | Verify by hand |')
    lines.append(f'| 3 | Description designates an area; not in that list | {len(cat3)} | Rectify |')
    lines.append(f'| 4 | Requirement references a number with no description | {len(cat4)} | Source/human |')
    lines.append(
        f'| 5 | Search page vs program page disagree on a course description | {len(cat5)} | Report to admin |'
    )
    lines.append(f'| 6 | Misspelled designation verb | {len(cat6)} | Report to admin |')
    lines.append(f'| 7 | Course in one source but not the other | {len(cat7)} | Report to admin |')
    lines.append('')

    def table(rows, headers, fields):
        lines.append('| ' + ' | '.join(headers) + ' |')
        lines.append('|' + '|'.join(['---'] * len(headers)) + '|')
        for r in rows:
            cells = []
            for f in fields:
                # CAT4 rows carry `area` for core requirements but `program` for
                # majors; surface whichever is present under the "Area / Program"
                # column.
                value = r.get(f)
                if value is None and f == 'area':
                    value = r.get('program', '')
                cells.append(str(value).replace('|', '\\|'))
            lines.append('| ' + ' | '.join(cells) + ' |')
        lines.append('')

    if cat1:
        lines.append('## 1. Modeled but not in the global catalog index')
        lines.append('')
        table(cat1, ['Code', 'Title', 'Program'], ['code', 'title', 'program'])
    if cat2:
        lines.append('## 2. Listed as fulfilling an area, but the description lacks it')
        lines.append('')
        table(cat2, ['Area', 'Code', 'Designated'], ['area', 'code', 'designated'])
    if cat3:
        lines.append('## 3. Description designates an area but the catalog omits it')
        lines.append('')
        table(cat3, ['Area', 'Code'], ['area', 'code'])
    if cat4:
        lines.append('## 4. Requirement references a number with no course description')
        lines.append('')
        table(cat4, ['Kind', 'Area / Program', 'Code'], ['kind', 'area', 'code'])
    if cat5:
        lines.append('## 5. Course Search and program page disagree')
        lines.append('')
        lines.append(
            'The `get_courses` (Course Search) and `get_program_courses_file` (program page)'
            ' endpoints return different text for these courses. `Similarity` is how alike the'
            ' two texts are (1 = identical); rows are ordered by largest disagreement first.'
            ' Report to the catalog admins.'
        )
        lines.append('')
        table(
            cat5,
            ['Code', 'Title', 'Similarity', 'Severity'],
            ['code', 'title', 'similarity', 'severity'],
        )
    if cat6:
        lines.append('## 6. Misspelled designation verb')
        lines.append('')
        lines.append(
            'The designation verb is misspelled in the description, so the CC/ACE token was'
            ' hard to match. Report the spelling to the catalog admins.'
        )
        lines.append('')
        table(cat6, ['Code', 'Title', 'Typo', 'Corrected'], ['code', 'title', 'typo', 'corrected'])
    if cat7:
        lines.append('## 7. Course in one source but not the other')
        lines.append('')
        lines.append(
            '`search-only` codes are in Course Search but appear on no program page;'
            ' `program-only` codes are on a program page but missing from Course Search.'
            ' Report to the catalog admins.'
        )
        lines.append('')
        table(cat7, ['Side', 'Code', 'Title', 'Program'], ['side', 'code', 'title', 'program'])

    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description='Audit catalog data for the issue classes.')
    ap.parse_args()

    majors = json.load(open(MAJORS_JSON))
    core_reqs = load_core_reqs()
    cat1, cat2, cat3, cat4, cat5, cat6, cat7 = audit(majors, core_reqs)

    with open(ISSUES_JSON, 'w', encoding='utf-8') as f:
        json.dump(render_json(cat1, cat2, cat3, cat4, cat5, cat6, cat7), f, indent=2, ensure_ascii=False)
        f.write('\n')
    with open(ISSUES_MD, 'w', encoding='utf-8') as f:
        f.write(render_md(cat1, cat2, cat3, cat4, cat5, cat6, cat7) + '\n')

    print(
        f'Categories: 1={len(cat1)}  2={len(cat2)}  3={len(cat3)}  4={len(cat4)}'
        f'  5={len(cat5)}  6={len(cat6)}  7={len(cat7)}'
    )
    print(f'Wrote {ISSUES_JSON}')
    print(f'Wrote {ISSUES_MD}')


if __name__ == '__main__':
    main()
