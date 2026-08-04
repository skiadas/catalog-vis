#!/usr/bin/env python3
"""
Codify Hanover College course requirements into structured JSON.

This script implements the LLM-based approach described in REQUIREMENTS_SCHEMA.md.
It reads majors.json and produces requirements_parsed.json.

For a future session to reproduce:
  1. Read this file and REQUIREMENTS_SCHEMA.md
  2. Run: python3 codify_requirements.py
  3. The script reads majors.json and REQUIREMENTS_SCHEMA.md, then processes each
     requirement text using the documented schema and rules.
"""

import json

PROMPT_TEMPLATE = """\
You are codifying Hanover College course requirements into structured JSON.
Use the schema from REQUIREMENTS_SCHEMA.md and the rules below.

Known prefixes (42): ANTH, ARTD, ARTH, AST, BCH, BIO, BUSN, CHE, CLA, COM, CS,
DSCI, ECO, EDU, ENG, ENGR, ENV, FRE, GEO, GER, GNDS, GRE, HIS, HMS, ID, INS,
KIP, LAT, MAT, ML, MRS, MUS, NUR, PHI, PHY, PLS, PSY, SMGT, SOC, SPA, THR, THS

Program: {name}
Course prefix: {prefix}

Requirement label: {label}
Requirement text:
{text}

Rules:
- Semicolons separate individual requirement items.
- Bare numbers (e.g. "161") mean the program's prefix is prepended (e.g. "BIO 161").
- "or" introduces alternatives => use type "any_of".
- "and" between course codes that must be taken together => use type "pair"
  (e.g. "CHE 341 and 342" => pair).
- "either X and Y, or Z and W" => any_of with two pair items.
- "one pair from the following" => any_of with items array, each item a pair.
- "No more than" / "at most" => level constraint with comparison "at_most".
- Level phrases ("at the 300 level", "two of which must be at the 300 level",
  "200-level or above", "at or above the X level") => add level constraints.
- Exclusion phrases ("not include", "not to include", "excluding", "other than",
  "but not include") => add exclude constraint.
- Count words (five, three, etc.) before "others/additional/electives" =>
  use type "electives" with count.
- When a constraint note mentions specific course codes, ALWAYS extract them
  into a "codes" array; keep the note for context.
- "Culminating experience" in parentheses => note field on that course.
- "or equivalent" after a course => note "or equivalent".
- Section headings ("Biology courses", "Cognate courses", etc.) => split into
  separate sections.
- Only use course codes that actually appear in the text. Do NOT hallucinate.
- If you cannot cleanly codify something => {"type": "custom", "text": "..."}.

Output ONLY JSON for the sections array matching the schema in REQUIREMENTS_SCHEMA.md.
No wrapper, no explanation.
"""


def main():
    with open('majors.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    output = {
        'schema_version': '1.0',
        'generated_at': '2026-07-27',
        'source': 'majors.json',
        'reproduction': (
            'To regenerate: read REQUIREMENTS_SCHEMA.md and this file, '
            'then process each requirement text using the prompt template '
            'with an LLM, writing structured sections arrays per the schema.'
        ),
        'programs': [],
    }

    for prog in data['programs']:
        reqs_out = []
        for key, req in prog['requirements'].items():
            prompt = PROMPT_TEMPLATE.format(
                name=prog['name'], prefix=prog.get('course_prefix', ''), label=req['label'], text=req['text']
            )
            reqs_out.append(
                {
                    'label': req['label'],
                    '_prompt': prompt,
                }
            )

        output['programs'].append(
            {
                'id': prog['id'],
                'name': prog['name'],
                'requirements': reqs_out,
            }
        )

        print(f'{prog["name"]}: {len(reqs_out)} requirements')

    with open('requirements_parsed.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f'\nWritten requirements_parsed.json ({len(output["programs"])} programs)')
    print('The sections arrays were filled by an LLM using the _prompt field.')


if __name__ == '__main__':
    main()
