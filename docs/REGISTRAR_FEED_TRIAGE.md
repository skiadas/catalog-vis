# Registrar CSV core-requirement conflicts

The schedule app's import validates each row's `core_requirements` cell against
the catalog (`core_requirements.json`) and flags disagreements in both
directions — areas the file adds, and areas it omits. Nothing is stored from the
column; the catalog stays the source of truth.

After the catalog update that added SL and HW and merged description-confirmed
designations into the area pools, the remaining disagreements are below. They
are data issues on one side or the other, not app bugs.

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

## 2. Needs the registrar's confirmation (catalog has no designation)

Neither the course description nor any core area lists these, but the file
claims them:

| Course | File says | Catalog | Question |
| --- | --- | --- | --- |
| GER 226, GER 326 | WL | — | Off-campus conversation courses; no "Satisfies" clause. Do they count toward the WL sequence? |
| SPA 229 | WL | — | Off-campus Spanish conversation; same question. |
| HF 101 | HW | — | The catalog's HW course is HF 105 ("Essential Movement for Elementary Children"); HF 101 ("Lifetime Health and Fitness") carries no HW designation. Is HF 101 the correct code, or should it be HF 105? |

## Background

- Core areas come from the core-curriculum page (`extract_core.py`); course
  descriptions are merged in for designations the page's lists omit
  (`audit_catalog.py` CAT3). After that merge, CAT3 is 0.
- SL (Scientific Laboratory / Field Study) is its own area — SM's
  laboratory/field-study component — and HW (Health and Wellness) is the new
  one-course requirement.
- Run `npm run test:data` / `npm run validate:catalog` after any catalog edit.
