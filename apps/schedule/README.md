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

An **offering** record:
`{ id, prefix, number, section, instructor, secondaryInstructors, days, time }`
(`days` ⊆ `MTWRF`, `time` = `"HH:MM-HH:MM"`). `instructor` is the single
**lead** instructor (0-or-1); `secondaryInstructors` is an array of 0-or-more
**other** instructors (e.g. the registrar's comma-separated `secondary_instr`
column). Blank `days`/`time` mark an **unscheduled** offering (independent
studies) — present in the schedule but excluded from the calendar/conflicts.
This is the same shape `parseCsv`/`makeSchedule` produce, so it maps directly
to registrar-style data feeds. Each row carries a stable content **`id`**, so
a section that appears as two rows with different meeting bands (split
meetings, e.g. MUS 001 A on MW and R at two custom times) keeps them as
distinct, independently editable offerings — edit/drag/undo on one never
touches its sibling, and history/suggestion diffs never invent cross-row
changes. Domain logic lives in `@major-vis/schedule-core`.

**Lab sections** are flagged offerings of a parent lecture: `lab: true`
(with `number` already the parent's, e.g. `'166'`) and a 1-based `labSeq`
carried in the **section cell** (the registrar writes `166L,A2` — the L
marks the lab, the digit is its sequence). A lab's identity is its full
tuple, never the mirrored lecture section. Imported `166L` + digit-section
numbers normalize on parsing and are written back by `renderCsv`; a lab
with no matching lecture section in its CSV feed is kept but flagged by the
import warning list. Labs group under the parent course (same name,
drill-down, and conflict treatment).

Term slot sets are provided by `@major-vis/schedule-core`'s `TERM_CONFIGS`:
Fall/Winter share a standard MWF/TR set; Spring has a single MTWRF group of four
slots, and a course may occupy up to two consecutive slots. Custom start/end
times are allowed; an offering can also be set to "No meeting time".

**Patterns the grid distinguishes:** the calendar is anchored to the term's
standard hours — one early/late class never stretches or hides the normal
grid. Classification is per day: a course whose meeting time matches a
standard band of that day merges into the normal block (even if its overall
day pattern is unusual), while a course whose time isn't a standard band of
the day (custom times, or bands belonging to another day group) renders as a
right-anchored dashed **"custom" rail** spanning 80% of the column width, and
its
in-range portion is clamped at the grid's edges with a corner notch when it
starts before or ends after the ruled hours. Courses entirely outside the
ruled hours — together with no-meeting-time courses — appear in the **"No
meeting times" strip** under the grid (draggable onto slots in edit mode, so
you can give an independent study a time). The strip and the rail keep
off-pattern courses visible without letting them compete with normal ones.

Clicking a grid block **opens its course list in the same footprint** (click
again to close; only one block open at a time), with a "View slot" link to
the slot page. Rails layer deterministically: normal bars on top of custom
rails (a rail stays clickable in the gaps between bars and past the ruled
hours); an opened block rises above everything. A toolbar **All · Normal ·
Custom** toggle (persisted locally) restricts the grid to all blocks, only
standard-slot bars, or only off-slot custom rails — hidden blocks stay
reachable via their slot/course pages.

**CSV**: import a file via "Your schedules" → **New schedule** → **Import
CSV…** — the file is the same round-trip / registrar format
(`dept_prefix,course_number,course_section,instructor,secondary_instr,days,times`
plus optional `term`) produced by "Download registrar CSV". An import **always
creates a new schedule** (name prefilled from the filename, year optional;
never touches existing schedules) and routes rows into its F/W/S parts by the
`term` column (rows without one land in the active term part). Blank or
literal `NULL` `days`/`times` cells mark unscheduled offerings; a `NULL` in the
`instructor` or `secondary_instr` columns reads as no instructor. A trailing `L` on
the course number with a digit in the section cell (`166L` + `A2`) becomes
a lab section of its parent. The optional `secondary_instr` column holds the
secondary instructors as a comma-separated, quoted list (`"Xu, Ray"`). Lab rows whose lecture
section isn't in the file are kept and reported in an import warning list.
`parseCsv`/`renderCsv` in `@major-vis/schedule-core` implement the format
(quoted-field aware).

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

In edit mode a course's row/pill gains a **drag grip** (a dotted handle at the
left edge, grab cursor) — the only draggable part of the row, so hover never
confuses drag (grip) with click (course code, instructor, pencil).

**The manage dialog shows your own schedules first.** The shared collection
still loads in full (suggestions and ownership checks work by id), but the
list defaults to owned rows; shared schedules are revealed by a toggle or by
searching by name _or owner username_, and a year filter narrows both sections.
The selection defaults to the first owned schedule (nothing when the user owns
none), so a stranger's schedule is never auto-selected.

**Labs**: the course editor's "Add lab section" (lecture rows only) creates a
lab that mirrors the lecture's section letter, copies its instructors (lead
plus secondary), and starts unscheduled in the "No meeting times" strip,
ready to drag onto a slot. Confirmation appears in the editor; if nothing
else was being edited the editor closes itself and drops the user back onto
the grid. Removing a lecture removes its labs; renaming a lecture's letter
renames its labs' to match.

**Course editor**: its action bar is pinned to the dialog's foot (Remove
course / Cancel / Save changes never scroll out of view), and closing a
dirty editor — outside click, ×, or Escape — asks before discarding: the
foot swaps to "Discard your unsaved changes?" with **Keep editing** /
**Discard** (deliberate exits — Cancel, Save, Remove — close directly). The
"Other instructors" field autocompletes from the term's instructor roster,
matching the last comma-separated token ("Smith, Jo" → pick Jones), replacing
the old chip wall.

**Recent changes & history**: the edit bar's **History** button opens the
session's change list. It is not an undo stack: the panel shows the **net
difference** between the current term and the session's base (what the term
looked like when the session started, per term), one row per affected course —
moving a course twice nets to a single "move" row, and moving it back removes
the row entirely (the change is nothing, net of the session). Each live row
offers **Cancel** (drops just that one change; the row flips to a
restorable "(cancelled)" marker) and **Edit** (jumps straight into that
course's editor, closing the panel — a mistake found later doesn't require
hunting the course on the grid). Cancelled rows offer **Restore**. The footer
has **Cancel all** and **Cancel latest**; **Ctrl/Cmd+Z** cancels the latest
change while the session is active, except when a text field has focus (that
stays browser-native text undo). The list is in-memory and session-scoped: it
clears on **Done**, on switching schedules, or on reload — the edits
themselves stay applied and persisted, only the ability to cancel them is
lost. Suggestion review actions (approve/reject/withdraw) are not cancellable
from here. While a session is active the schedule manager also disables
new-schedule actions (New schedule / Generate / Import CSV / Duplicate), so
an edit in progress is never disturbed by a concurrent create.

## Suggested changes (remote, and mirrored offline)

When the app is served by the backend (`server/`), `initScheduleCollection`
pings `/api/config` and switches to **remote mode**: the schedule list and term
edits are mirrored to the API (`apps/schedule/src/backend.js`) instead of
`localStorage`. A visitor without a session sees the **auth prompt** — sign in,
or **work offline**. Sign-in follows the provider the server advertises via
`/api/config` (`auth.provider`): username self-identify (inline form; dev and
tests) or **OIDC** — a "Sign in with SSO" button that redirects to the identity
provider and back to `/api/auth/callback`, after which the server provisions
the account from the verified email. A failed round-trip lands back with
`?auth_error=<code>`, which the prompt turns into a message. Offline mode is
for testing use only: the app runs entirely on
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
