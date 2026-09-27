# Working with the table view

The **Table** tab shows every offering of the selected schedules' term as one
compact, spreadsheet-like row — the fastest way to scan a whole department and
the quickest place to make a series of small changes.

<Shot file="schedule-table.png" />

## The columns

**Course** and section, **Title**, **Instructor**, **Meeting**, **Seats**,
**Core** areas, and **Schedule** (which of the shown schedules the row belongs
to). The corner count — **N offerings** — tells you how many rows are in view.
The term buttons (**Fall**, **Winter**, **Spring**) apply here like everywhere
else.

## Narrowing the list

The **Departments** and **Instructors** chips hide everything that does not
match. Pick several chips to widen the list; click a selected chip to drop it;
**Clear** resets both.

- The Departments row starts expanded; the Instructors row starts collapsed —
  click its header to expand it (or to tuck it away again).
- A collapsed row keeps its selected chips visible, so you can still remove
  them, and the header shows how many are selected.
- The choice lives in the address, like a link you can keep:
  `#/table?dept=CS&dept=MAT&instructor=jsmith`. Following a course link and
  pressing Back, or returning later, restores it.

## Read-only, or editable

Outside a session the table is read-only — the hint in the corner says so —
and every value is plain text. Start an **edit** session (the pencil on a
schedule you own) or a **suggest** session (the speech bubble), and the cells
you are allowed to change become editable in place: your departments' rows, as
usual. In a suggest session the hint reminds you that the edits are limited to
your departments and become proposals. Rows from other selected schedules stay
dimmed as references, and nothing on them can be changed.

- **Title** and **Seats** — click and type. Enter or clicking away commits;
  Esc cancels.
- **Instructor** — click the cell, start typing, and pick from the name
  suggestions (or **Show all instructors**). Co-teachers are not editable
  here: the cell shows the lead teacher and a **+N** count, and the full
  editor manages the rest of the roster.
- **Meeting** — click the cell and pick one of the term's standard time slots,
  **No meeting time**, or **Custom…** to type a meeting of your own.
- Every committed edit lands in the draft and **History** exactly like a
  change made anywhere else in the app; input that cannot be read simply
  reverts.

## Row actions

- The **pencil** opens the full [course editor](/guide/schedule/edit-course),
  where labs, cross-listing, and co-teachers live.
- The **trash** removes the section from the schedule, after a confirmation.
- **＋ Add course** sits in the table's header during a session and opens the
  same dialog as everywhere else.

## Related

- [The views at a glance](/guide/schedule/views) — grid, day, and slot.
- [Editing vs suggesting](/guide/schedule/edit-vs-suggest) — starting a
  session.
- [Submitting changes](/guide/schedule/proposals) — sending your draft.
