# Registrar CSV core-requirement notes

The schedule app now treats the imported registrar feed as authoritative: each
row's `core_requirements` cell is stored on the offering and drives the course
view, core filter, CoreStats, and export (the catalog only fills in for rows the
feed didn't tag). The import summary still *notes* where a row differs from our
catalog snapshot, but only informationally — nothing is blocked and the file is
never overridden.

The notes below are therefore about data quality on one side or the other
(useful to send to the registrar / catalog admins), not app problems. Where the
feed shows the catalog itself is stale, the fix belongs in the catalog so new
empty schedules (which fall back to it) agree — that overlay is
`tools/catalog-pipeline/core_corrections.json` (section 2).

## 1. The registrar file looks incomplete (catalog and descriptions agree)

The catalog and the course's own description agree; the file's
`core_requirements` cell omits an area (or adds one the description does not
support).

| Course | File says | Catalog says | Evidence |
| --- | --- | --- | --- |
| HFA 045, 060, 067, 074, 076, 077, 096 | AF | AF, HW | Current descriptions: "Satisfies the HW Skills in the Hanover Core. Partially satisfies AF CCR." HFA 066 carries the HW tag in the same file, so the column is non-uniform. |
| HF 105 | AF | AF, HW | "Satisfies the HW Skills in the Hanover Core. Counts as 0.25 credit toward the AF CCR." |
| ENG 322 | LA | LA, W2 | "Satisfies the W2 ACE" (the LA clause is partial). |
| ENV 265 | S, SL | SM, SL, S | "Partially satisfies the SM CCR. Satisfies the SL CCR. Satisfies the S ACE." SL courses count toward SM, so the file's SL tag but omitted SM is a tagging inconsistency. |
| HFA 048 | HW, AF | HW | The description confirms HW only; there is no AF clause. |

## 2. Catalog was missing the designation (now applied)

Neither the course description nor any core area listed these, but the file
claims them. The registrar's feed is the more current word, so they are applied
to the catalog via `tools/catalog-pipeline/core_corrections.json` — the
committed overlay `extract_core.py` merges after scraping:

| Course | File says | Catalog (before) | Note |
| --- | --- | --- | --- |
| GER 226, GER 326 | WL | — | Off-campus conversation courses; no "Satisfies" clause. |
| SPA 229 | WL | — | Off-campus Spanish conversation; same. |
| HF 101 | HW | — | HF 105 ("Essential Movement for Elementary Children") was the catalog's HW course; the feed tags HF 101 ("Lifetime Health and Fitness") as well, so both are listed. |

## Background

- Core areas come from the core-curriculum page (`extract_core.py`); course
  descriptions are merged in for designations the page's lists omit
  (`audit_catalog.py` CAT3). After that merge, CAT3 is 0.
- The registrar feed's corrections then overlay the pools
  (`core_corrections.json`): a corrected code's list replaces its parsed
  membership, so the feed wins for a course it tags. Add an entry there when the
  feed reveals a designation the page misses.
- SL (Scientific Laboratory / Field Study) is its own area — SM's
  laboratory/field-study component — and HW (Health and Wellness) is the new
  one-course requirement.
- Run `npm run test:data` / `npm run validate:catalog` after any catalog edit.
