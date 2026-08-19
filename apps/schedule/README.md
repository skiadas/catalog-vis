# schedule app

Schedule review and editing: multiple named schedules, weekly grid/day/slot
views, per-course and per-instructor drill-downs, conflict detection, and
edit-mode drag/course editing.

## Inputs

Catalog data via `@major-vis/catalog-client` (course names, faculty pools for
generation). `main.js` calls `loadCatalog({ baseUrl: '../../' })` (the
repo-root JSON when co-deployed); override that `baseUrl` for a
college-hosted source.

## Persistence (localStorage)

- `major-vis.schedules` — `[{ id, name, year, terms: { F: { offerings, version }, W: ..., S: ... } }]`
- `major-vis.schedule.selected` — visible schedule ids
- `major-vis.schedule.color` — "color by schedule" toggle
- `major-vis.schedule.term` — the active term (`F`/`W`/`S`)

A **schedule** is a named, yearly entry that owns three term parts (Fall/Winter/
Spring), each a separate `offerings` collection; the app edits one term at a time
(`activeTerm`). Older single-term records are migrated on load into every term
part.

An **offering** record: `{ prefix, number, section, instructor, days, time }`
(`days` ⊆ `MTWRF`, `time` = `"HH:MM-HH:MM"`). Blank `days`/`time` mark an
**unscheduled** offering (independent studies) — present in the schedule but
excluded from the calendar/conflicts. This is the same shape `parseCsv`/
`makeSchedule` produce, so it maps directly to registrar-style data feeds.
Domain logic lives in `@major-vis/schedule-core`.

Term slot sets are provided by `@major-vis/schedule-core`'s `TERM_CONFIGS`:
Fall/Winter share a standard MWF/TR set; Spring has a single MTWRF group of four
slots, and a course may occupy up to two consecutive slots. Custom start/end
times are allowed (the calendar grows to fit them); an offering can also be set
to "No meeting time".

**CSV**: use the schedule app's "Upload CSV" to load a file into a schedule's
active term (or its `term` column parts); the file is the same round-trip /
registrar format (`dept-prefix,course-number,section,instructor,days,times`
plus optional `term`) produced by "Download year CSV". `parseCsv`/`renderCsv`
in `@major-vis/schedule-core` implement the format (quoted-field aware).

On load the app seeds a deterministic "Sample schedule" (`seedSampleSchedule`,
seed 42) into the Fall part unless schedules already exist.

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
