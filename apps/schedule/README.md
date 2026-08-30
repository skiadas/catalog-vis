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
- `major-vis.schedule.pending` — pending-suggestion overlay toggle
- `major-vis.schedule.suggestions` — the offline suggestion trail (serverless mode)
- `major-vis.schedule.offline` — "1" when the user chose **work offline** on a
  server-backed deployment (local-only testing mode; see the auth-prompt
  section below)

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
times are allowed; an offering can also be set to "No meeting time".

**Patterns the grid distinguishes:** the calendar is anchored to the term's
standard hours — one early/late class never stretches or hides the normal
grid. A course whose time isn't a standard band of its day group (custom
times, TR-band times on MWF days after a careless day-group switch) renders as
a **half-width dashed "custom" rail** instead of a full block, and its
in-range portion is clamped at the grid's edges with a corner notch when it
starts before or ends after the ruled hours. Courses entirely outside the
ruled hours — together with no-meeting-time courses — appear in the **"No
meeting times" strip** under the grid (draggable onto slots in edit mode, so
you can give an independent study a time). The strip and the rail keep
off-pattern courses visible without letting them compete with normal ones.

**CSV**: use the schedule app's "Upload CSV" to load a file into a schedule's
active term (or its `term` column parts); the file is the same round-trip /
registrar format (`dept-prefix,course-number,section,instructor,days,times`
plus optional `term`) produced by "Download year CSV". `parseCsv`/`renderCsv`
in `@major-vis/schedule-core` implement the format (quoted-field aware).

On load the app seeds a deterministic "Sample schedule" (`seedSampleSchedule`,
seed 42) into the Fall part unless schedules already exist.

## Edit and suggest modes

Every schedule's pencil button opens a mode picker: **Edit** writes the schedule
directly and **Suggest changes** collects edits into a draft, shown live on the
calendar (the draft stands in for the published term while the session is
active). Both are offered to owners and offline users; in remote mode a
non-owner is only offered Suggest (direct writes require ownership, enforced
server-side). Proposing diffs the draft against the server's current term and
upserts the proposer's own pending suggestion (create, or replace the ops of
their existing pending one), so a department's edits always consolidate into
one coherent proposal — never redundant intermediate moves — and re-enter a
suggestion session by replaying their own pending ops onto the freshest
published state.

## Suggested changes (remote, and mirrored offline)

When the app is served by the backend (`server/`), `initScheduleCollection`
pings `/api/config` and switches to **remote mode**: the schedule list and term
edits are mirrored to the API (`apps/schedule/src/backend.js`) instead of
`localStorage`. A visitor without a session sees the **auth prompt** — sign in
(username self-identify; owners are whoever created a schedule), or **work
offline**. Offline mode is for testing use only: the app runs entirely on
`localStorage` (option "Work offline" remembers the choice in
`major-vis.schedule.offline`), the top nav shows an "Offline — testing only"
badge with a "Go online" button, and nothing created offline **ever transfers**
to the server — going online replaces the browser's view with the server's
collection (the prompt repeats the warning when leaving offline mode). A
returning visitor with a live session loads the shared collection silently,
no prompt. Suggestions are concurrent: any number of departments may hold
live pending proposals ("suggested moves"), visible to everyone — pending
suggestions render as dashed overlay blocks on the calendar (the "Show
proposals" toggle, on by default), so departments see where each other plan to
offer courses. The owner reviews each pending suggestion **change by change**:
every operation of a suggestion is first-class (its own id + resolution:
`pending`/`accepted`/`rejected`/`withdrawn`), and the panel offers an
individual Approve/Reject per change. The proposer can withdraw their own
changes one at a time or all at once ("Withdraw all"); a suggestion stays live
while any of its changes is pending, and once every change is decided its
status is the derived summary — `approved` (some accepted change landed),
`moot` (accepted changes changed nothing), `withdrawn` (the proposer pulled the
rest), or `rejected` (the owner rejected everything). Once the owner has
resolved any change the proposer can no longer replace the proposal's ops
(reviewing locks the list); withdrawing individual pending changes is still
allowed, and further edits then go to a fresh row. The panel keeps the full
paper trail (proposer, note, operations with per-change statuses, timestamps).

Without a server, the app runs entirely on `localStorage`, and the same
suggestion lifecycle is mirrored there (`major-vis.schedule.suggestions`) so
testing offline exercises the real flow. The "Your schedules" manager, save
button, and all mutating actions behave identically in both modes.

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
