# Glossary

One place for the terms used across the repo. The data contract, pure packages,
and apps sometimes use different words for the same concept — this maps them.

## Core concepts

| Term | Meaning | Where it appears |
|------|---------|------------------|
| **program** | An academic program (major, minor, or other) in the catalog. | `majors.json` `programs[]`, browse app |
| **`majors.json`** | The scraped-catalog filename. Despite the name it holds **programs**, not just majors. | repo root, `scrape_catalog.py` output |
| **course code** | A course's identity, `PREFIX NNN` (e.g. `BIO 161`). | everywhere |
| **`course_code`** | The property name for a course code inside `majors.json` course records. | `majors.json`, `catalog-client` |
| **`code`** | The property name for a course code inside parsed requirement items. | `requirements_parsed.json`, `degree-audit` |
| **offering** | A scheduled section of a course: `{ prefix, number, section, title, instructor, secondaryInstructors, days, time, seats }` (`instructor` = single lead; `secondaryInstructors` = array of other instructors; `title` = the offering's own title, `''` = catalog name; `seats` = requested seat count, default 24). Registrar-shaped. | schedule app, `schedule-core` |
| **offering title** | An offering's own title (special-topics topics), distinct from the catalog course name; `''` falls back to the catalog name. A lab shares its lecture's title. Optional CSV `title` column; editable in the course editor. | schedule app, `schedule-core`, CSV |
| **seats** | The requested seat count for one offering row (a positive integer, default `DEFAULT_SEATS` = 24; a lab has its own, distinct from its lecture). Optional `seats` CSV column; editable in the course editor. | schedule app, `schedule-core`, CSV |
| **core area / `core_reqs`** | A core-curriculum area id (`LA`, `HS`, `SM`, `SL`, `HW`, ...) a course satisfies. The optional `core_reqs` CSV column carries the comma-separated ids: the imported row's ids are stored on the offering and are authoritative for the schedule's views/filter/stats, with the catalog as a fallback for untagged rows; imports also note (informationally) where they differ from the catalog snapshot. The catalog's own lists come from the core-curriculum page plus the committed registrar-feed overlay (`tools/catalog-pipeline/core_corrections.json`). | `core_requirements.json`, `catalog-client`, `schedule-core`, CSV |
| **cross-listed group** | The same course under several department codes (`CS 263` / `ENGR 263` / `PHI 263`), from `cross_listings.json`. A group's offerings are kept identical and share an owning department (`crossListOwner`); the optional `cross_listed` CSV column lists the materialized sibling prefixes. | `cross_listings.json`, `catalog-client`, schedule app, `schedule-core`, CSV |
| **course (vs offering)** | A catalog course (identity + name/description) vs a scheduled offering (one section at a time). | catalog vs schedule |
| **allCourses** | The catalog-client ref: a map keyed by course code. | `catalog-client`, all apps |
| **parsed requirement** | One requirement in `requirements_parsed.json`: `{ label, sections }`. | planner, browse |
| **track** | A planner's addable unit — one parsed requirement (or the core curriculum). | planner |
| **`trackKey` / `trackSlug`** | A track's stable key: slug of the requirement's `label`. | `catalog-client.programTracks`, planner |
| **core curriculum** | Modeled as a planner-only fake "program" (`CORE_ID = 'core-curriculum'`), with a single `CORE_TRACK`. Not in the browseable catalog. | `catalog-client`, planner |
| **join keys** | The strings that link pieces together (see below). | the contract |

## Requirement model

Each parsed requirement has `sections` → `items`. Item **types**:

| Type | Meaning |
|------|---------|
| `course` | A single required course. |
| `any_of` | One of the alternatives (`codes` XOR `items`). |
| `each_of` | Every listed item. |
| `some_of` | At least `min` of the listed items. |
| `electives` | `count` courses chosen from a `constraints`-scoped pool. |
| `custom` | Unstructured narrative text (cannot be evaluated automatically). |

`electives` **constraints** (filters + aggregates, see
`packages/catalog-contract/REQUIREMENTS_SCHEMA.md`):

| Constraint | Meaning |
|------------|---------|
| `level` | A level band (e.g. 300 = 300–399, `orAbove` widens) or a min/max range. |
| `discipline` | Prefix filter + counts (`atLeast`, `atMost`, `distinctAtLeast`, `sameDiscipline`). |
| `from` | An explicit pool (may be note-only, with no `codes`). |
| `exclude` | Courses that don't count. |
| `max_from` / `min_from` | At most / at least N from a pool. |

Filters **scope the universe**; aggregates **verify counts over the chosen set**.

## Join keys

| Key | Form | Notes |
|-----|------|-------|
| Course code | `PREFIX NNN` | Slash codes (`ENG/COM 251`), aliases (`GNDR → GNDS`), ranges (`ENV 408-409`) appear in requirement text and are resolved by `expandCode` in `degree-audit`. |
| Program id | derived from the program **name** | e.g. `anthropologycultural`. |
| Track key | slug of the requirement **label** | stable across re-scrapes. |
| Core area id | `LA`, `HS`, … | `core_requirements.json` requirement ids. |
| Cross-list group | concrete codes (`CS 263`, `ENGR 263`) | membership from `cross_listings.json`; never derived from the code shape. |
| `scheduleView` | `grid` \| `day` \| `slot` \| `course` \| `instructor` | the schedule app's sub-view param. |

## Mechanisms

| Term | Meaning |
|------|---------|
| **import map** | The `<script type="importmap">` in each app's `index.html` that maps `@major-vis/*` to package files. |
| **`baseUrl`** | The argument to `loadCatalog({ baseUrl })` — the seam for pointing an app at a catalog source. Co-deployed apps pass `'../../'`. |
| **`independentSections`** | A requirement flag (core curriculum) letting one course satisfy several sections at once. |
| **`coreReqStats`** | Pure `schedule-core` helper: per core area, offering/seat counts per term plus totals (labs excluded, split meetings merged, cross-listed versions collapsed to one shared seat pool). |
| **schema_version** | The contract version (`2.0`) on `requirements_parsed.json` / `core_requirements.json`. |
| **`dataContract`** | See `packages/catalog-contract` — schemas + validator + consumer matrix. |
