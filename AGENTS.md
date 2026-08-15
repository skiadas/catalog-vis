# Major Catalog Visualizer — Agent Guide

## Project Overview

A set of **independently deployable static Vue 3 apps** that browse Hanover
College's 55 academic programs, review/edit schedules, and plan majors/minors,
plus the Python pipeline that scrapes and codifies the catalog into JSON. Data
is scraped from https://catalog.hanover.edu.

The repo is an **npm-workspaces monorepo** with four shared packages and three
apps. The design goal: each piece is **self-contained with a documented
contract** (inputs, outputs, persistence shapes, cross-app links) so it can be
lifted onto its own host or reimplemented elsewhere — e.g. against a
college-hosted catalog API.

## Repository Layout

```
packages/
  catalog-contract/          THE DATA CONTRACT: JSON Schemas + validator + REQUIREMENTS_SCHEMA.md
  catalog-client/            browser catalog data layer (loadCatalog + refs + filters + tracks)
  degree-audit/              pure requirements evaluator (node --test-able)
  schedule-core/             pure schedule domain model + generator (node --test-able)
  router/                    tiny hash-router factory (createRouter)
apps/
  browse/                    program & course catalog (index.html + import map + main.js + router.js)
  schedule/                  schedule review/editing + src/scheduleStore.js + scheduleDrag.js
  planner/                   degree planner + audit + src/plannerStore.js
tools/catalog-pipeline/      Python: scrape, codify, extract_core, audit, merge, md_to_html, test_data
```

Apps are **build-free**: each `index.html` loads Vue from a CDN global and uses
a relative `<script type="importmap">` mapping `@major-vis/*` → `../packages/*`.
Pure packages never import Vue (testable under `node --test`); `catalog-client`
and the app stores use the Vue global.

For newcomers, `docs/ARCHITECTURE.md` explains how the pieces fit and offers a
reading order; `docs/GLOSSARY.md` maps the terminology (program vs `majors.json`,
course code vs `code`, offerings vs courses, track keys, join keys).

## The Pieces

### 1. Catalog pipeline (`tools/catalog-pipeline/`)

Batch scripts (run from the repo root; they read/write the root JSON):

| Script                   | Purpose                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `scrape_catalog.py`      | Fetch catalog HTML + API data → `majors.json`                                            |
| `codify_requirements.py` | LLM prompt template → `requirements_parsed.json` (refuses to overwrite unless `--force`) |
| `extract_core.py`        | CCR/ACE areas → `core_requirements.json` (+ gap report)                                  |
| `audit_catalog.py`       | Cross-check the three artifacts → `catalog_issues.{json,md}`                             |
| `md_to_html.py`          | pandoc + CSS → self-contained `catalog_issues.html`                                      |
| `merge_classics.py`      | One-off migration (Classics → Classical Studies)                                         |
| `test_data.py`           | Data-integrity invariants (`npm run test:data`)                                          |

All scripts anchor data files to the repo root via `ROOT` (parents[2]), so they
work from any cwd. **Output = the three JSON artifacts**, which are the catalog
data contract.

Scraping notes (scrape_catalog.py): API course codes carry double spaces
(`BIO  161`) — `.normalize_code()` collapses them; program IDs derive from
program **name** (source HTML ids are wrong); requirement prefixes uppercased;
faculty names normalized + deduped. The global `catalog` index is the union of
the API and every program list. Source/presence disagreements between the two
endpoints are recorded in `source_discrepancies` / `presence_discrepancies`,
not silently resolved.

### 2. Catalog data contract (`packages/catalog-contract/`)

The hub. Three JSON Schemas (draft 2020-12) in `schemas/`: `majors.schema.json`,
`requirements.schema.json`, `core.schema.json`. `validate.mjs` (ajv) checks the
committed JSON (`npm run validate:catalog`, run in CI). The schemas are a
**parallel artifact** to `REQUIREMENTS_SCHEMA.md` (human semantics) and
`tools/catalog-pipeline/test_data.py` (imperative/derived invariants) — keep
all three in sync. The README holds the consumer-needs matrix + join keys.

**Join keys**: course code (`PREFIX NNN`; requirement text may use slash codes
`ENG/COM 251`, aliases `GNDR→GNDS`, ranges `ENV 408-409` — resolved by
`expandCode`), program id (name-derived), track key (slug of a parsed
requirement's label), core area id (`LA`, `HS`, …).

### 3. Shared packages

- **`catalog-client`** (`@major-vis/catalog-client`) — browser-only. Exports
  reactive `programs`, `allCourses`, `parsedRequirements`, `coreRequirements`,
  `loading`, browse filters, `loadCatalog({ baseUrl, files })`, and the track
  identity helpers `programTracks`/`trackSlug`/`CORE_ID`/`CORE_TRACK`. **The
  `baseUrl` argument is the single seam** for pointing an app at a
  college-hosted catalog source. Full contract in its README.
- **`degree-audit`** (`@major-vis/degree-audit`) — pure evaluator:
  `satisfied`, `assignRequirement`, `evaluateRequirement/Program`, `audit`,
  `planGaps`, `gapGroups`, `describeConstraints`, `expandCode`, `prefixMatch`,
  `passes`, `filteredUniverse`, `checkAggregates`. Data passed in as args; no
  framework. Could run as a server-side degree-audit service.
- **`schedule-core`** (`@major-vis/schedule-core`) — pure schedule domain:
  offering parsing (`parseCsv`), index (`buildIndex`), conflicts, calendar
  layout, colors, filters, editing (`moveOfferingSmart` …), drag payload
  (`buildDragPayload`/`dragPayloadFrom`), and generation (`./generate`:
  `makeSchedule(mode, prefix, facultyByPrefix, eligible, seed)` with a
  mulberry32 PRNG). The offering record `{prefix, number, section, instructor,
days, time}` is registrar-shaped.
- **`router`** (`@major-vis/router`) — `createRouter(routes, fallback)`: each
  app registers a route table (`{ view, parse(parts, query), href(params) }`)
  and re-exports its own `route`/nav helpers.

### 4. The apps

Each app's README documents its input contract, localStorage persistence, and
cross-app links. Summary:

|                | browse                                  | schedule                                                           | planner                                         |
| -------------- | --------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| Catalog inputs | all refs                                | courses + faculty pools                                            | programs + parsed + core                        |
| Persistence    | none                                    | `major-vis.schedules`, `.schedule.selected`, `.schedule.color`     | `major-vis.planner.plans`, `.planner.active`    |
| Routes         | `#/`, `#/program/:id`, `#/course/:code` | `#/`, `#/day/:d`, `#/slot/:d/:t`, `#/course/:c`, `#/instructor/:i` | `#/` (+ deep-link query)                        |
| Emits links    | → planner (`plannerUrl`)                | —                                                                  | → browse (`browseProgramUrl`/`browseCourseUrl`) |
| Consumes links | —                                       | —                                                                  | `?program=&track=`                              |

`apps/schedule/src/scheduleStore.js` holds the schedule collection/filters/
generation/seeding; `apps/planner/src/plannerStore.js` holds plans/tracks/
timeline state. Neither app imports the other's store. The schedule app seeds
its "Sample schedule" (seed 42) via `seedSampleSchedule()` after `loadCatalog`.

## Cross-App Deep-Link Contract

Apps are separate modules/hosts, so navigation between them is URLs, not
function calls:

- `browse → planner`: `../planner/#/?program=<id>&track=<trackKey>` — planner
  parses the query on load and `addTrack`s it (idempotent). Built by
  `plannerUrl` in `apps/browse/router.js`.
- `planner → browse`: `../browse/#/program/<id>` and `../browse/#/course/<code>`
  via `browseProgramUrl`/`browseCourseUrl` in `apps/planner/router.js`.

`trackKey` is a stable slug of the requirement label (see `programTracks`).
Since hostnames may diverge, these are plain URLs — only the origin prefix
changes.

## Data Pipeline Workflow

Regeneration from the catalog:

1. **Scrape**: `python3 tools/catalog-pipeline/scrape_catalog.py` → `majors.json`
2. **Codify**: apply `codify_requirements.py`'s LLM prompt + `REQUIREMENTS_SCHEMA.md` → `requirements_parsed.json`
3. **Extract core**: `python3 tools/catalog-pipeline/extract_core.py` → `core_requirements.json` (prints CCR/ACE vs catalog gaps)
4. **Audit**: `python3 tools/catalog-pipeline/audit_catalog.py` → `catalog_issues.{json,md}`
5. **Render report**: `python3 tools/catalog-pipeline/md_to_html.py` (pandoc) → `catalog_issues.html`

### Requirement model (`requirements_parsed.json`, `schema_version: 2.0`)

Item types: `course`, `any_of` (codes XOR items), `each_of`, `some_of` (min),
`electives` (count + constraints), `custom` (unstructured). Constraints on
`electives`: `level` (band or min/max range, with `atLeast`/`atMost`/`orAbove`),
`discipline` (`prefixes`, counts, `distinctAtLeast`, `sameDiscipline`),
`from` (pool; may be note-only), `exclude`, `max_from`, `min_from`. Filters
scope the universe; aggregates verify counts over the chosen set. Core
curriculum sections are marked `independentSections` (a course may satisfy
several areas at once).

### Catalog audit classes (CAT1–CAT7)

CAT1 modeled-but-not-indexed · CAT2 listed-but-not-designated · CAT3
designated-but-not-listed · CAT4 required-but-unmodeled · CAT5
source-disagreement (similarity + severity) · CAT6 designation-typo
(typo-tolerant designation verbs) · CAT7 presence-disagreement
(search-only/program-only). `catalog_issues.md` is the triage table.

## Frontend Architecture

- Vue 3 CDN global; ES modules; no runtime build. Package `exports` are used by
  Node tests; browsers resolve `@major-vis/*` via each app's import map. The
  only preprocessing is CSS (SCSS in `style/` → committed per-app `style.css`).
- `RequirementItem` renders the requirement model recursively; the planner
  reuse the same `requirements_parsed.json`/`core_requirements.json` shapes.
- The weekly calendar views (`ScheduleGrid`, `ScheduleInstructor`) share a
  `daycol` scoped-slot scaffold.
- The planner's "taken" set is the union of all timeline slots; the evaluator
  (`degree-audit`) never sees timing — only the set of codes.

## Formatting

- JS/HTML: `npx prettier@3.3.3 --write "**/*.{js,html,css,scss}"` (config in
  `.prettierrc.json`; `*.json` and the compiled `apps/*/style.css` ignored).
- Python: `python3 -m black .` (config in `pyproject.toml`, keeps single
  quotes). `.editorconfig` covers indents/line endings.
- **CSS**: authored in SCSS under `style/` with **decisions centralized**:
  `_tokens.scss` is the single source of truth for color/type/spacing/radius/
  shadow (never hard-code these in rules); `_mixins.scss` holds the repeated
  looks (`surface`, `flex-row`, `pill`, `icon-btn`, `button-reset`); `_base.scss`
  has the reset + typography + shared components; `_{browse,schedule,planner}.scss`
  are thin component assemblies referencing tokens/mixins. Compile with
  `npm run build:css` and commit the generated `apps/<name>/style.css` alongside
  the source.

## Development Workflow

- **Commit often, in small logical units.** Finish a feature (or a coherent
  slice) and commit it before moving on; never let unrelated work pile up in
  one changeset.
- **Committing and verifying are part of completing a task.** Run the same
  checks CI runs, all must pass _before_ you commit:
  - `npx prettier@3.3.3 --write "**/*.{js,html,css,scss}"` then
    `npx prettier@3.3.3 --check "**/*.{js,html,css,scss}"`
  - `npm test` (workspaces: degree-audit, schedule-core, catalog-contract)
  - `npm run validate:catalog` (contract schemas)
  - `npm run test:data` (Python data-integrity)
  - `npm run check:css` (rebuilds `apps/*/style.css` and fails on drift)
  - `npm run lint` (eslint)
  - `python3 -m black .` then `python3 -m compileall -q -x "node_modules|/\.git/" .`
- **Amend instead of adding fixup commits** if the latest commit is unpushed
  and the fix is for issues it introduced.
- **Never push unless asked.** Inspect `git status`/`git diff` before staging.

## Common Tasks

- **Re-scrape**: `python3 tools/catalog-pipeline/scrape_catalog.py`
- **Regenerate requirements**: LLM with prompt from `codify_requirements.py` +
  schema from `packages/catalog-contract/REQUIREMENTS_SCHEMA.md`
- **Regenerate core**: `python3 tools/catalog-pipeline/extract_core.py`
- **Audit catalog**: `python3 tools/catalog-pipeline/audit_catalog.py`
- **Render report**: `python3 tools/catalog-pipeline/md_to_html.py`
- **Serve locally**: `python3 -m http.server 8080` → `http://localhost:8080/apps/browse/`
- **Lift an app to its own host**: copy `apps/<name>/`, set the catalog
  `baseUrl` in its `main.js`, point the nav links at the other apps' hosts,
  ensure the catalog host allows CORS (GitHub Pages sends
  `Access-Control-Allow-Origin: *`).

## Current State / Known Limitations

- All three apps deployed together on GitHub Pages from the repo root (the
  root `index.html` redirects to `apps/browse/`); hostname split is enabled by
  the seams but not yet done.
- Complex multi-line "one pair from the following" sections are structured
  (`any_of`/`each_of`/`some_of`); a few "one of X and one of Y" combos remain
  `each_of`s. Education's narrative prose and `.25 unit`/topic-category notes
  stay `custom` — no `credit`/topic restriction kind yet.
- Courses a requirement references with no description anywhere are surfaced
  as **CAT4** (genuine source gaps, not planner bugs).
- Plans and schedules persist only in `localStorage` — no accounts/backend yet;
  server-side degree audit and college-API catalog serving are the intended
  next steps.
