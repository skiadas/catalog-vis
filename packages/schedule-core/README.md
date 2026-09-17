# @major-vis/schedule-core

Pure schedule domain model for Hanover's catalog. No framework or DOM
dependencies; all data is passed in as arguments, so it runs under
`node --test`, in the browser, or as a server-side schedule service.

Two entry points: `.` (domain model) and `./generate` (schedule generation).

## Contract — `.` (schedule.js)

An **offering** is the primitive record, in the shape `parseCsv` produces:

```js
{ id: 'ok16mz2', prefix: 'BIO', number: '161', section: 'A', instructor: 'Patterson', secondaryInstructors: ['Xu', 'Ray'], days: 'MWF', time: '8:00-9:10' }
```

`instructor` is the single **lead** instructor (0-or-1, mirroring the
registrar `instructor` column); `secondaryInstructors` is the 0-or-more
**other** instructors from the `secondary_instr` column (comma-separated in
the source, stored as an array). Records written before the multi-instructor
model simply lack the key — `instructorsOf(o)` (below) reads it as empty, so
old schedules stay valid.

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
renumbered deterministically.

### Parsing + index

- `parseCsv(text)` → `offering[]` (columns `dept_prefix`,
  `course_number`, `course_section`, `instructor`, `secondary_instr`, `days`,
  `times`; blank or literal `NULL` cells — meeting _and_ instructor columns —
  mark "no value" (a `NULL` lead reads as no instructor, a `NULL`
  `secondary_instr` as no others, `NULL` tokens inside a list are dropped);
  the optional `secondary_instr` column is a commma-separated (quoted) list parsed
  into `secondaryInstructors`; `166L` + section-cell lab digits with
  deterministic labSeq for colliding rows)
- `renderCsv(offerings)` → round-trip CSV (`secondary_instr` written back
  after `instructor`, properly quoted; lab numbers written back as `166L`,
  sequences as section digits `A1`/`A2`)
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
  the one key every identity match uses; `courseNumberLabel(o)` → the
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
  `departmentsInSchedule(index)`
- `buildFilter(mode, depts, instructors)` → `{ active, matches(item), color(item) }`
- `buildVisual(mode, depts, instructors, scheduleIds, colorSchedules)` →
  filter-first, then schedule coloring, else inactive

### Drag payload (shared with the planner timeline)

- `buildDragPayload(it, fromDay)` → serialized
  `{ sid, id, prefix, number, section, lab, labSeq, fromDay }` (the content
  `id` rides along so a split-meeting row drags only itself)
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
