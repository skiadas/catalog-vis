# schedule app

Schedule review and editing: multiple named schedules, weekly grid/day/slot
views, per-course and per-instructor drill-downs, conflict detection, and
edit-mode drag/course editing.

## Inputs

Catalog data via `@major-vis/catalog-client` (course names, faculty pools for
generation). `loadCatalog()` defaults to page-relative JSON at the repo root;
override `baseUrl` in `main.js` for a college-hosted source.

## Persistence (localStorage)

- `major-vis.schedules` — `[{ id, name, offerings }]`
- `major-vis.schedule.selected` — visible schedule ids
- `major-vis.schedule.color` — "color by schedule" toggle

An **offering** record: `{ prefix, number, section, instructor, days, time }`
(`days` ⊆ `MTWRF`, `time` = `"HH:MM-HH:MM"`). This is the same shape
`parseCsv`/`makeSchedule` produce, so it maps directly to registrar-style data
feeds. Domain logic lives in `@major-vis/schedule-core`.

On load the app seeds a deterministic "Sample schedule" (`seedSampleSchedule`,
seed 42) unless schedules already exist.

## Routes

- `#/` — grid
- `#/day/:day`, `#/slot/:day/:time`, `#/course/:code`, `#/instructor/:name`

## Cross-app links

None emitted or consumed today (course pills navigate within the app; a link to
the browse course page can be added as `../browse/#/course/<code>`).

## Serve / lift out

Static server; import map resolves `@major-vis/*` to `../packages/*` relative
to this directory (whole repo served for now). To lift out: copy `apps/schedule/`,
set the catalog `baseUrl`, and point the nav links at the other apps' hosts.
