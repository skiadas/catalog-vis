# Major Catalog Visualizer — Agent Guide

## Project Overview

A deployable static Vue 3 SPA that browses Hanover College's 55 academic programs, their courses, and requirements. Data is scraped from https://catalog.hanover.edu and stored as JSON.

## Key Files

| File | Purpose |
|------|---------|
| `scrape_catalog.py` | Scraper: fetches catalog HTML + API data, outputs `majors.json`. Normalizes course codes and faculty names |
| `majors.json` | All 54 programs, 1144 courses, requirement texts |
| `requirements_parsed.json` | Codified requirements (structured JSON per `REQUIREMENTS_SCHEMA.md`) |
| `REQUIREMENTS_SCHEMA.md` | Schema docs for requirements codification — item types, rules, known prefixes |
| `codify_requirements.py` | Reproduction script with LLM prompt template for re-processing |
| `generate_schedule.py` | Generates a synthetic schedule CSV from `majors.json` faculty (deterministic, seeded) |
| `merge_classics.py` | One-off migration: merge the two Classics majors into a single "Classical Studies" department exposing both majors (keys `major`/`major_2`/`minor`); applied |
| `sample-schedule.csv` | Schedule data parsed in the browser (dept-prefix,course-number,section,instructor,days,times) |
| `index.html` | Vue 3 SPA entry point (CDN-loaded, type="module") |
| `app.js` | App shell + mount point + global component registration |
| `lib/store.js` | Shared reactive state (programs, courses, filters, schedule) |
| `lib/router.js` | Hash router (programs, courses, schedule, planner views) |
| `lib/schedule.js` | Schedule domain model + helpers (parsing, index, conflicts, colors, calendars) |
| `lib/planner.js` | Pure requirements evaluator + planning/audit helpers (nodes, filters vs aggregate constraints, `planGaps`, `audit`) |
| `components/ProgramList.js` | Program list view |
| `components/ProgramDetail.js` | Program detail with requirements + course tabs |
| `components/RequirementSection.js` | Groups a section's `items` (merges consecutive `course`s) + renders each via `RequirementItem` |
| `components/RequirementItem.js` | Recursive renderer for every requirement item type (`course`/`any_of`/`each_of`/`some_of`/`electives`/`custom` + constraint tags) |
| `components/PlannerApp.js` | Planner view: add/remove major+minor tracks, per-track audits, global course picker |
| `components/TrackAudit.js` | Per-track planner audit block (status, section chips, `planGaps` "still need" list) |
| `components/CourseDetail.js` | Single course detail view |
| `components/WeeklyCalendar.js` | Shared weekly-calendar scaffold (header, ruler, guides; `daycol` slot) |
| `components/ScheduleApp.js` | Schedule shell + view switching + filters |
| `components/ScheduleGrid.js` | Grid view (calendar blocks by slot) |
| `components/ScheduleDay.js` / `ScheduleSlot.js` | Day and slot drill-down views |
| `components/ScheduleCourse.js` | Per-course offerings + conflicts |
| `components/ScheduleInstructor.js` | Per-instructor timetable + double-bookings |
| `.editorconfig` / `.prettierrc.json` / `pyproject.toml` | Formatter configs (Prettier for JS, Black for Python) |
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
- Faculty names are normalized (`.normalize_faculty_name()`): whitespace collapsed, single trailing period stripped (e.g., `Patterson.` → `Patterson`), and duplicates removed while preserving order
- Output: `majors.json` with 54 programs, each with `requirements` (label + raw text), `courses` array, and metadata

### 2. Requirements Codification (`codify_requirements.py` + `REQUIREMENTS_SCHEMA.md`)

Requirement text is transformed into structured JSON using an **LLM-based approach** (not a parser).

**Item types** (`requirements_parsed.json` is `schema_version: 2.0`):
- `course` — a specific course (`{"type": "course", "code": "BIO 161"}`)
- `any_of` — choose exactly one of the alternatives; `codes` (flat courses) or `items` (arbitrary nested items) (`{"type": "any_of", "codes": ["BIO 335", "BIO 352"]}`)
- `each_of` — satisfy ALL the sub-requirements (`{"type": "each_of", "items": [...]}`); replaces the legacy `pair`
- `some_of` — satisfy at least N of the sub-requirements (`{"type": "some_of", "min": 2, "items": [...]}`)
- `electives` — N courses with optional constraints (`{"type": "electives", "count": 5, "constraints": [...]}`)
- `custom` — anything that can't be cleanly codified (`{"type": "custom", "text": "..."}`)

**Constraint types** (attach to `electives` `constraints` arrays; a course must pass all):
- `level`: `{"type": "level", "level": 300, "atLeast": 2}`, level bands `{"type": "level", "min": 160, "max": 169}` (e.g. "GEO 16x"), counts via `atLeast`/`atMost`, `"orAbove": true`
- `discipline`: prefix-based, `{"type": "discipline", "prefixes": ["GER"], "atLeast": 7}`, `"atMost"`, or `"distinctAtLeast"` ("from different disciplines")
- `from`: `{"type": "from", "codes": ["CHE 324", "CHE 325"]}` (eligible pool)
- `exclude`: `{"type": "exclude", "codes": ["BIO 301", "BIO 307"]}`
- `max_from`: cap on a set, `{"type": "max_from", "codes": [...], "atMost": 1}` ("no more than N of")
- `min_from`: floor on a set, `{"type": "min_from", "codes": [...], "atLeast": 2}` ("at least N of")

**Known prefixes** (42): ANTH, ARTD, ARTH, AST, BCH, BIO, BUSN, CHE, CLA, COM, CS, DSCI, ECO, EDU, ENG, ENGR, ENV, FRE, GEO, GER, GNDS, GRE, HIS, HMS, ID, INS, KIP, LAT, MAT, ML, MRS, MUS, NUR, PHI, PHY, PLS, PSY, SMGT, SOC, SPA, THR, THS

### 3. Schedule Generation (`generate_schedule.py`)

Produces `sample-schedule.csv` from `majors.json` faculty:
- Maps each `course_prefix` to its faculty pool (including interdisciplinary programs whose courses carry those prefixes)
- Samples ~30% of eligible courses (seeded with `random.seed(42)` for determinism)
- Assigns instructors by fewest-load; no instructor double-booked within a slot; no two sections of the same course in the same slot
- Writes `dept-prefix,course-number,section,instructor,days,times`

### 4. Reprocessing Requirements (for future sessions)

To regenerate `requirements_parsed.json` from `majors.json`:
1. Read `REQUIREMENTS_SCHEMA.md` for the schema + rules
2. Read `codify_requirements.py` for the prompt template
3. For each program/requirement in `majors.json`, apply the prompt with an LLM
4. Fill the `sections` array per the schema

## Frontend Architecture

- Vue 3 loaded from CDN with `type="module"`
- ES modules: no build step, components are `.js` files with template strings
- Hash-based routing (`#/` → list, `#/program/:id` → detail, `#/course/:code` → course, `#/schedule` and subviews, `#/planner`)
- Components use `Vue.defineComponent()` and are registered in `app.js`
- `RequirementItem` renders recursively (any item type may nest inside another via `any_of.items` / `each_of.items` / `some_of.items`); `RequirementSection` groups only the section's top-level consecutive `course`s
- The planner view is separate from program browsing: a program's addable units are its **tracks** (one per parsed requirement, keyed by the `majors.json` requirements slug); clicking a program in the list jumps to `#/planner` with its tracks added
- Weekly calendar views (`ScheduleGrid`, `ScheduleInstructor`) share the `WeeklyCalendar` scaffold via a `daycol` scoped slot; the day header is clickable only when an `onDayClick` prop is provided

## Formatting

- JS/HTML: Prettier 3 via `npx prettier@3.3.3 --write <files>` (config in `.prettierrc.json`, ignores in `.prettierignore`)
- Python: Black via `python3 -m black <files>` (config in `pyproject.toml`, with `skip-string-normalization` to keep single quotes)
- `.editorconfig` covers indent/line-ending conventions for editors

## Current State

**Completed**:
- Scraper produces clean `majors.json` with normalized course codes and faculty names
- All 54 programs have proper unique IDs (derived from program name)
- Requirements codified for all programs with structured JSON output (`schema_version: 2.0`)
- Requirement model normalized: `any_of`/`each_of`/`some_of` composition, `discipline`/`level` bands+counts, `max_from`/`min_from`; legacy `pair`/`level_gate` retired
- `test/test_data.py` validates the requirements model vocabulary (node/constraint types, code formats, known discipline prefixes)
- `test/planner.test.js` (node --test) exercises the evaluator/`planGaps`/`audit` against hand-built fixtures for every node + constraint kind
- Vue 3 SPA with program list, detail, course detail views, and filter/sort
- Requirements planner: pure evaluator (`lib/planner.js`), a dedicated `#/planner` view with add/remove major+minor tracks, per-track audits + "still need" gaps, and a global course picker (session-only taken-courses)
- Schedule generator produces a deterministic synthetic `sample-schedule.csv`
- Schedule SPA: grid, day, slot, course, and instructor views with dept/instructor filters, conflicts, and shared `WeeklyCalendar`
- "Classical Studies" one department exposing both majors + the minor (keys `major`/`major_2`/`minor`) via `merge_classics.py`

**Known limitations in requirements_parsed.json**:
- Complex multi-line "one pair from the following" sections use nested `any_of`/`each_of` items (e.g., Biology BS and CS BS cognates are now fully structured); a few remaining nested combos ("one of X and one of Y") are `each_of`s
- Education's narrative descriptions and program-admission prose are preserved as `custom` items
- Timing notes ("before end of junior year") stored as note fields on courses
- `.25 unit` credit notes and topic-category requirements (e.g., Theological Studies "one course in biblical studies") remain `custom` — no `credit`/topic restriction kind yet
- Cross-listing is resolved in the planner: `majors.json` carries a global `catalog` (all API courses, incl. codes that appear in no single program's list, e.g. `HF 101`, `SMGT 332`, `HFA 076`), and `expandCode()` splits slash codes (`ENG/COM 251` → `ENG 251`/`COM 251`) and applies prefix aliases (`GNDR` → `GNDS`). `lib/store.js` seeds `allCourses` from `catalog` first, then per-program details.
- Only three requirement codes exist *nowhere* in the scraped data (global catalog or per-program lists) and stay unresolvable: `COM 221`, `LAT 471`, `LAT 499` — genuine gaps at the source catalog, not a planner bug.

## Common Tasks

- **Re-scrape**: `python3 scrape_catalog.py` (updates `majors.json`)
- **Regenerate requirements**: Use LLM with prompt from `codify_requirements.py` + schema from `REQUIREMENTS_SCHEMA.md`
- **Regenerate schedule**: `python3 generate_schedule.py` (updates `sample-schedule.csv`; deterministic with seed 42)
- **Format JS/HTML**: `npx prettier@3.3.3 --write app.js index.html lib/*.js components/*.js`
- **Format Python**: `python3 -m black scrape_catalog.py generate_schedule.py codify_requirements.py`- **Serve locally**: `python3 -m http.server 8080` then open `http://localhost:8080`
