# planner app

Degree planner: add major/minor/core tracks, lay courses on a year × term
timeline, and audit progress against parsed requirements via the
`@major-vis/degree-audit` engine.

## Inputs

Catalog data via `@major-vis/catalog-client` (programs, `requirements_parsed.json`,
`core_requirements.json`, `allCourses`). `loadCatalog()` defaults to
page-relative JSON at the repo root; override `baseUrl` in `main.js`.

## Persistence (localStorage)

- `major-vis.planner.plans` — `[{ id, name, slots, tracks }]`
- `major-vis.planner.active` — active plan id

`slots` maps year/term keys (`y1f`…`y4s`, `transfer`, `unassigned`) to course
code arrays; `tracks` is `[{ programId, trackKey }]`. The audit's "taken" set
is the union of all slots.

## Routes

- `#/` — the planner
- `#/?program=<id>&track=<trackKey>` — same view, with that track added on
  load (cross-app deep link from the browse app; idempotent).

## Cross-app links

- **Consumed**: `../planner/#/?program=<id>&track=<trackKey>` from browse
  ("Add to planner").
- **Emitted**: `../browse/#/program/<id>` (program names in the add-track
  picker) and `../browse/#/course/<code>` (`browseProgramUrl`/`browseCourseUrl`
  in `router.js`).

## Serve / lift out

Static server; import map resolves `@major-vis/*` to `../packages/*` relative
to this directory (whole repo served for now). To lift out: copy
`apps/planner/`, set the catalog `baseUrl`, and point nav links at the other
apps' hosts. The track keys that deep links carry are stable slugs of
requirement labels (see `@major-vis/catalog-client` `programTracks`).
