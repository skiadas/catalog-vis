# Major Catalog Visualizer — Agent Guide

## Project Overview

A deployable static Vue 3 SPA that browses Hanover College's 54 academic programs, their courses, and requirements. Data is scraped from https://catalog.hanover.edu and stored as JSON.

## Key Files

| File | Purpose |
|------|---------|
| `scrape_catalog.py` | Scraper: fetches catalog HTML + API data, outputs `majors.json` |
| `majors.json` | All 54 programs, 1144 courses, requirement texts |
| `requirements_parsed.json` | Codified requirements (structured JSON per `REQUIREMENTS_SCHEMA.md`) |
| `REQUIREMENTS_SCHEMA.md` | Schema docs for requirements codification — item types, rules, known prefixes |
| `codify_requirements.py` | Reproduction script with LLM prompt template for re-processing |
| `index.html` | Vue 3 SPA entry point (CDN-loaded, type="module") |
| `app.js` | App shell + mount point |
| `lib/store.js` | Shared reactive state (programs, courses, filters) |
| `lib/router.js` | Hash router (program list → detail → course detail) |
| `components/ProgramList.js` | Program list view |
| `components/ProgramDetail.js` | Program detail with requirements + course tabs |
| `components/CourseDetail.js` | Single course detail view |
| `style.css` | Styles |

## Data Pipeline

### 1. Scraping (`scrape_catalog.py`)

```
GET / → main HTML with program requirements
POST action=get_courses → all 1144 courses with codes/names/descriptions
POST action=get_program_courses_file&program_course=XXX → per-prefix course lists
```

Key behaviors:
- Course codes from API contain **double spaces** (e.g. `BIO  161`); `.normalize_code()` collapses to single space
- Program IDs are derived from the program **name** (not the HTML div id) because the source HTML has incorrect IDs (e.g., "Computer Science" content inside `<div id="Creative Writing">`)
- All known prefixes in requirement text are uppercased (e.g., "Bio" → "BIO")
- Output: `majors.json` with 54 programs, each with `requirements` (label + raw text), `courses` array, and metadata

### 2. Requirements Codification (`codify_requirements.py` + `REQUIREMENTS_SCHEMA.md`)

Requirement text is transformed into structured JSON using an **LLM-based approach** (not a parser).

**Item types**:
- `course` — a specific course (`{"type": "course", "code": "BIO 161"}`)
- `any_of` — alternatives (`{"type": "any_of", "codes": ["BIO 335", "BIO 352"]}`)
- `electives` — N courses with optional constraints (`{"type": "electives", "count": 5, "constraints": [...]}`)
- `custom` — anything that can't be cleanly codified (`{"type": "custom", "text": "..."}`)

**Constraint types**:
- `level`: `{"type": "level", "level": 300, "min": 2}` or `{"type": "level", "level": 200, "comparison": "or_above"}`
- `exclude`: `{"type": "exclude", "codes": ["BIO 301", "BIO 307"]}`
- `from`: `{"type": "from", "codes": ["CHE 324", "CHE 325"]}`

**Known prefixes** (42): ANTH, ARTD, ARTH, AST, BCH, BIO, BUSN, CHE, CLA, COM, CS, DSCI, ECO, EDU, ENG, ENGR, ENV, FRE, GEO, GER, GNDS, GRE, HIS, HMS, ID, INS, KIP, LAT, MAT, ML, MRS, MUS, NUR, PHI, PHY, PLS, PSY, SMGT, SOC, SPA, THR, THS

### 3. Reprocessing Requirements (for future sessions)

To regenerate `requirements_parsed.json` from `majors.json`:
1. Read `REQUIREMENTS_SCHEMA.md` for the schema + rules
2. Read `codify_requirements.py` for the prompt template
3. For each program/requirement in `majors.json`, apply the prompt with an LLM
4. Fill the `sections` array per the schema

## Frontend Architecture

- Vue 3 loaded from CDN with `type="module"`
- ES modules: no build step, components are `.js` files with template strings
- Hash-based routing (`#/` → list, `#/program/:id` → detail, `#/course/:code` → course)
- Components use `Vue.defineComponent()` and are registered in `app.js`

## Current State

**Completed**:
- Scraper produces clean `majors.json` with normalized course codes
- All 54 programs have proper unique IDs (derived from program name)
- Requirements codified for all programs with structured JSON output
- Level numbers filtered, bare numbers resolved with correct prefix, exclusion lists applied
- Vue 3 SPA with program list, detail, course detail views, and filter/sort

**Known limitations in requirements_parsed.json**:
- Complex multi-line "one pair from the following" sections (e.g., Biology BS cognates, CS BS cognates) use `custom` type rather than being fully parsed
- Education's narrative descriptions are preserved as `custom` items
- Timing notes ("before end of junior year") stored as note fields on courses

## Common Tasks

- **Re-scrape**: `python3 scrape_catalog.py` (updates `majors.json`)
- **Regenerate requirements**: Use LLM with prompt from `codify_requirements.py` + schema from `REQUIREMENTS_SCHEMA.md`
- **Serve locally**: `python3 -m http.server 8080` then open `http://localhost:8080`
