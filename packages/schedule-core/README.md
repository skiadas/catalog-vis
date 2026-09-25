# @major-vis/schedule-core

Pure schedule domain model for Hanover's catalog. No framework or DOM
dependencies; all data is passed in as arguments, so it runs under
`node --test`, in the browser, or as a server-side schedule service. The only
runtime dependencies are `csv-parse` and `csv-stringify` (their browser ESM
builds), used by `parseCsv`/`renderCsv`.

Three entry points: `.` (domain model), `./generate` (schedule generation), and
`./diff` (suggested-change diffing).

## Contract — `.` (schedule.js)

An **offering** is the primitive record, in the shape `parseCsv` produces:

```js
{ id: 'ok16mz2', prefix: 'BIO', number: '161', section: 'A', title: '', instructor: 'Patterson', secondaryInstructors: ['Xu', 'Ray'], days: 'MWF', time: '8:00-9:10', seats: 24 }
```

`title` is the offering's own title (optional): `''` means "fall back to the
catalog name", which is how special-topics sections carry a per-offering title
while the course keeps its catalog title. It is **per offering row** (a lab
always shares its lecture's title — `parseCsv` mirrors it and
`updateOfferingInSchedule` cascades a lecture edit onto its labs), and it is
not part of an offering's identity. `parseCsv` reads the optional `title`
column; `renderCsv` writes it.

`instructor` is the single **lead** instructor (0-or-1, mirroring the
registrar `instructor` column); `secondaryInstructors` is the 0-or-more
**other** instructors from the `secondary_instr` column (comma-separated in
the source, stored as an array). Records written before the multi-instructor
model simply lack the key — `instructorsOf(o)` (below) reads it as empty, so
old schedules stay valid.

`seats` is the requested seat count for the section (a positive integer),
defaulting to `DEFAULT_SEATS` (24) when unspecified. It is **per offering row**
— a lab carries its own limit, independent of the lecture it mirrors — and it
is not part of an offering's identity (editing it never changes the content
`id`). The app's course editor and the `#/course/:code` view surface it; the
CSV carries it as the optional `seats` column (`parseCsv` reads it, `renderCsv`
writes it).

`crossListOwner` is the cross-list group's owning department prefix (`''` or
absent = not grouped, or an imported group no one has claimed yet). It is
app-state — not part of the offering's identity, and never serialized to CSV —
but `diffOfferings` includes it in an update op's `changes` (so a first edit
that claims an imported group survives propose/approve) while keeping it out of
the human-readable `diff` detail.

**`id`** is a deterministic content hash producers assign at import/creation
(and fill on legacy records during load): two rows that share a section tuple
but meet at different bands — a _split meeting_, e.g. MUS 001 A on MW
16:00-16:50 AND R 16:10-17:00 — are distinct offerings with distinct ids, and
identical duplicate rows get a first-seen `-1`/`-2` suffix. Every identity
match (`matchOffering`, update/remove/move/diff/apply/drag) prefers the id, so
editing or dragging one meeting leaves its sibling untouched; the tuple key
remains the fallback for legacy rows without ids. Ids are never serialized to
CSV; re-parsing the same file yields the same ids.

`days` is a subset of `MTWRF`; `time` is a `"HH:MM-HH:MM"` 24h band.
Time-band _logic_ compares minute values, never band strings: any spelling of
the same minutes (`08:00-09:10`, whitespace, `08:00:00` seconds) is treated
identically, and bands are stored/exported in the canonical `8:00-9:10` form
(`parseCsv` and the app's editor normalize on write via `normalizeBand`).
Unparseable or reversed bands (`end <= start`) are invalid: they pass through
unchanged, render off-pattern, and are never silently blanked.

**Lab sections** are flagged offerings of their parent course: `lab: true`
(with `number` already normalized to the parent, e.g. `'166'`) plus a
1-based `labSeq`. The registrar carries the sequence in the **section cell**
(`A2` = section A, lab 2), so a parsed `166L,A2` row becomes
`{ number: '166', section: 'A', lab: true, labSeq: 2 }`; `renderCsv` and
`sections`-style labels write it back as `A2`. A lab's identity is its full
tuple — `prefix/number/section` plus the lab marker — so it is never confused
with the lecture section it mirrors. A trailing `L` on the course number marks
the lab; colliding rows (two identical `A1` rows serving one lecture) are
renumbered deterministically. A lab also shares its lecture's `title`
(`parseCsv` mirrors it; an orphan lab with no lecture row keeps its own).

### Parsing + index

- `CSV_COLUMNS` — the canonical column order (`dept_prefix`, `course_number`,
  `course_section`, `title`, `instructor_name`, `secondary_instr_name`, `days`,
  `times`, `seats`, `instructor`, `secondary_instr`, `core_reqs`,
  `cross_listed`). `renderCsv`
  builds its header from it and the app's summary export reuses `renderCsv`, so
  the order lives in one place. The instructors come in two blocks: `instructor`
  / `secondary_instr` carry the canonical **usernames** (the identity the
  round-trip keys on) and sit after the meeting columns; `instructor_name` /
  `secondary_instr_name` carry the directory's human name in "Last, First" form
  (see `lastFirst`) and sit up with the identity columns. `core_reqs` and
  `cross_listed` are last, just before the optional `term`: the core-curriculum
  area ids and the other department prefixes the offering is cross-listed with
  — display/validation aids, not offering identity (catalog-free, the app
  resolves the values).
- `parseCsv(text)` → `offering[]` (header-driven via `csv-parse`, so column
  order never matters; a UTF-8 BOM, CRLF endings, quoted cells with embedded
  commas/newlines, and ragged rows are tolerated; a malformed file yields `[]`
  rather than throwing). Columns: the `CSV_COLUMNS` above plus an optional
  `term`; blank or literal `NULL` cells — title,
  meeting _and_ instructor columns — mark "no value" (a `NULL` lead reads as no
  instructor, a `NULL` `secondary_instr` as no others, `NULL` tokens inside a
  list are dropped); the optional `secondary_instr` column is a commma-separated
  (quoted) list parsed into `secondaryInstructors`; the optional `title` column
  is the offering's own title; the optional `seats` column
  is a positive integer defaulting to `DEFAULT_SEATS` (24) when absent/blank/
  invalid; the optional `core_reqs` column is a comma-separated list carried
  through verbatim as `coreReqs` (always present, default `[]`); the optional
  `cross_listed` column is a comma-separated list carried through as
  `crossListed` (always present, default `[]`); `166L` +
  section-cell lab digits with deterministic labSeq for
  colliding rows, and lab titles mirrored from their lecture). The
  `instructor_name`/`secondary_instr_name` columns are **display-only and
  ignored**: identity comes from the username columns, so a feed that omits them
  imports with blank instructors.
- `renderCsv(offerings, { fullName } = {})` → round-trip CSV written by
  `csv-stringify` from `CSV_COLUMNS` (plus `term` when any row carries one), so
  the header and cells can't drift apart: records are mapped by column name
  (`title` right after `course_section`; instructor columns quoted; `seats` blank
  when a row has none; `core_reqs` blank when a row has none; labs written back
  as `166L` + section digits `A1`/`A2`).
  `fullName(username)` → the directory display name; the name columns are then
  written as "Last, First". Without it — or for a username it does not know — the
  name cell falls back to the username, so an offline export still names every
  instructor.
- `lastFirst(name)` → the directory full name in the registrar's "Last, First"
  form (`"John Wahl"` → `"Wahl, John"`; an already-comma or single-token name
  passes through unchanged)
- `DEFAULT_SEATS = 24` (the fallback seat count)
- `buildIndex(offerings)` → `{ byCourse, byDay, bySlot, byInstructor,
unscheduled }`; each list is sorted (`compareItems`) and items carry
  `{ o, code, sid, sectionLabel, start, end, days, lab, instructors }` where
  `sid` is `o.$sid`, `start`/`end` are minutes, `sectionLabel` is `Section A` or
  `Lab A2` (the registrar's letter + sequence), `lab` flags lab items, and
  `instructors` is the offering's distinct instructor list (lead + secondary,
  `instructorsOf(o)`). Every instructor is indexed under `byInstructor`, so
  filters and the per-instructor view cover team-taught courses too.
  Labs group under the parent course's `code`, so they share its catalog
  name and never conflict with their own lecture (same-code skip in
  `conflictsForCourse`); a lab still conflicts with any _other_ course.

### Slot blocks + time

- `WEEKDAYS = ['M','T','W','R','F']`, `WEEKDAY_NAMES`
- `SLOT_BLOCKS = [{ label: 'MWF', slots }, { label: 'TR', slots }]` with the 6
  MWF + 4 TR standard bands (`{ days, time, start, end }`)
- `DEFAULT_SLOT` (first MWF band), `toMinutes(hhmm)`, `formatTime(time)`
  (a blank time renders as `"No meeting time"`), `slotKey(day, time)`,
  `daySlotTimes(day)`
- `termSlotOptions(termKey, day)` → that day's assignable bands
- `isStandardPattern(termKey, days, time)` → the full-pattern test: whether an
  offering's day set sits in one day group with one of that group's standard
  bands. `daySlotBlocks` classifies per day instead — a course that coincides
  with a standard band of that day merges into the normal block even when its
  overall pattern fails this test
- `daySlotBlocks(day, index, termKey)` → that day's grid blocks
  (`[{ time, start, end, items, offPattern }]`)
- `compareItems(a, b)`, `compareCodes(a, b)`

### Editing

- `rescheduleDays(days, fromDay, toGroup, toDay)` → day-set after a drag
- `moveOfferingSmart(offerings, { prefix, number, section, lab, labSeq }, { fromDay, toDay, group, time })`
  → new offerings array (pure; identity matches the full tuple)
- `updateOfferingInSchedule(offerings, cur, changes)` → new array (pure);
  a change that blanks one side of `days`/`time` blanks the other, so a
  half-set record can never survive a write (both-blank is the
  no-meeting-time shape). Renaming a lecture's section letter cascades to
  its labs (re-derived `labSeq`, so they never collide with labs already on
  the new letter)
- `addOfferingToSchedule(offerings, offering)`, `removeOfferingFromSchedule(offerings, cur)`
  (removing a lecture also removes its labs — a lab without its lecture is
  meaningless)
- `nextSectionLetter(offerings, prefix, number)` → first free section letter
  (lab rows are ignored — their letters mirror the lecture's)
- `offerKey(o)` → the stable identity tuple (`prefix|number|section|L|seq`),
  the one key every identity match uses; `offeringItemKey(it)` → the render
  identity of an indexed item (record identity + content id + source
  schedule) — the key lists mixing a lecture with its labs must use (the
  plain `code + section` is identical for a lecture and every lab on its
  letter); `courseNumberLabel(o)` → the
  registrar-shaped number (`166L` for labs, plain for lectures);
  `offeringSectionLabel(o)` → the registrar-shaped section (`A2` for labs,
  plain for lectures); `nextLabSeq(offerings, prefix, number, section)` →
  the next free lab sequence for a lecture

### Conflicts

- `conflictsBetween(a, b)` → overlapping day + time
- `conflictsForCourse(code, index)` → sorted distinct conflicting codes
- `instructorConflicts(index)` → `[{ instructor, a, b }]` double-bookings

### Calendar layout

- `DAY_START_MIN = 480`, `DAY_END_MIN = 960`, `PX_PER_MIN = 1`
- `hourMarks()`, `formatHour(min)`,
  `blockStyle(slot)` (absolute-position styles)
- `calendarDayRange(termKey)` → the term's standard rendered range (anchored,
  so an off-pattern early/late class never stretches the grid)
- `clipBand(band, range)` → the band's in-range portion with `clippedTop` /
  `clippedBottom` flags (or `null` when nothing falls inside the range)

### Display + filters

- `briefInstructor(name)`, `instructorChip(o)` (the grid's one-name label —
  brief lead plus a `*` when others are attached), `instructorsOf(o)` (the
  distinct lead + secondary list), `colorForDept(prefix)`,
  `colorForInstructor(name)`, `colorForSchedule(sid)` (deterministic palettes)
- `instructorSortKey(name)`, `compareInstructors`, `instructorsInSchedule(index)`,
  `departmentsInSchedule(index)`, `coreReqsInSchedule(index, reqs)` (the areas
  any course in the schedule satisfies; `reqs` is the catalog's list, passed in)
- `colorForCoreReq(id)` (the core filter's chip/block palette)
- `buildFilter(mode, depts, instructors, coreReqs, reqsOf)` →
  `{ active, matches(item), color(item) }`; mode is `'dept'`, `'instructor'`, or
  `'core'` (a course matches when `reqsOf(item.code)` intersects the selected
  area ids — the resolver is passed in, keeping the package catalog-free)
- `buildVisual(mode, depts, instructors, scheduleIds, colorSchedules, coreReqs, reqsOf)`
  → filter-first, then schedule coloring, else inactive
- `coreReqStats(offeringsByTerm, reqs, crossGroups)` → per-area
  `{ id, label, terms: { F, W, S }, totals }` offering/seat counts. Labs never
  count (not as an offering, not their seats); split meetings collapse to one;
  a section in more than one schedule counts once; cross-listed versions (same
  group, same section) collapse to one and share the first row's seats.
  Unscheduled offerings count. `crossGroups` is the catalog's cross-listing
  groups, passed in to keep the package catalog-free.

### Drag payload (shared with the planner timeline)

- `buildDragPayload(it, fromDay)` → serialized
  `{ sid, id, prefix, number, section, lab, labSeq, crossListOwner, fromDay }`
  (the content `id` rides along so a split-meeting row drags only itself; the
  owner rides along so the drop-time permission check can see the group owner)
- `dragPayloadFrom(e)` → parsed payload (or `null`) from a `dataTransfer`

## Contract — `./generate` (generate.js)

Deterministic (seeded) schedule generation from the catalog.

- `mulberry32(seed)` → seeded PRNG
- `buildFacultyAndEligible(programs, allCourses)` → `{ facultyByPrefix, eligible }`
  (prefix → sorted faculty list; eligible courses whose prefix has faculty)
- `makeSchedule(mode, prefix, facultyByPrefix, eligible, seed)` → `offering[]`
  (`'random'` ≈30% of eligible; `'dept'` ≈40% of one prefix). Output offerings
  are in `parseCsv` shape and slot-assigned with no instructor double-booking
  and no duplicate course-in-slot.

## Test

```sh
npm test            # from this package
```

## Reimplementing elsewhere

The offering shape and `buildIndex`/conflict semantics are the contract; any
service producing or validating schedules should speak this shape. Course names
and descriptions are not part of this package — pair it with the catalog client.
