# @major-vis/schedule-core

Pure schedule domain model for Hanover's catalog. No framework or DOM
dependencies; all data is passed in as arguments, so it runs under
`node --test`, in the browser, or as a server-side schedule service.

Two entry points: `.` (domain model) and `./generate` (schedule generation).

## Contract — `.` (schedule.js)

An **offering** is the primitive record, in the shape `parseCsv` produces:

```js
{ prefix: 'BIO', number: '161', section: 'A', instructor: 'Patterson', days: 'MWF', time: '8:00-9:10' }
```

`days` is a subset of `MTWRF`; `time` is a `"HH:MM-HH:MM"` 24h band.

**Lab sections** are flagged offerings of their parent course: `lab: true`
(with `number` already normalized to the parent, e.g. `'166'`) plus a
1-based `labSeq` when a lecture has several labs on the same section letter
(two `166L,A` rows at different times serve one lecture section). A lab's
identity is its full tuple — `prefix/number/section` plus the lab marker —
so it is never confused with the lecture section it mirrors. A trailing `L`
on a parsed course number (`166L`, `166L2`) becomes `lab`/`labSeq`; `renderCsv`
writes it back so exports stay in the registrar shape.

### Parsing + index

- `parseCsv(text)` → `offering[]` (columns `dept-prefix`,
  `course-number`, `section`, `instructor`, `days`, `times`; blank or literal
  `NULL` meeting cells mark an unscheduled offering; `166L`/`166L2` lab
  normalization with deterministic labSeq for duplicate rows)
- `renderCsv(offerings)` → round-trip CSV (lab numbers written back as
  `166L`/`166L2`)
- `buildIndex(offerings)` → `{ byCourse, byDay, bySlot, byInstructor,
unscheduled }`; each list is sorted (`compareItems`) and items carry
  `{ o, code, sid, sectionLabel, start, end, days, lab }` where `sid` is
  `o.$sid`, `start`/`end` are minutes, `sectionLabel` is `Section A` or
  `Lab A` (` · 2` when a lab has a `labSeq`), and `lab` flags lab items.
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
- `isStandardPattern(termKey, days, time)` → whether an offering's time is one
  of its day group's standard bands (the off-pattern test the grid's rail cue
  uses)
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
  registrar-shaped number (`166L`/`166L2`); `nextLabSeq(offerings, prefix,
number, section)` → the next free lab sequence for a lecture

### Conflicts

- `conflictsBetween(a, b)` → overlapping day + time
- `conflictsForCourse(code, index)` → sorted distinct conflicting codes
- `instructorConflicts(index)` → `[{ instructor, a, b }]` double-bookings

### Calendar layout

- `DAY_START_MIN = 480`, `DAY_END_MIN = 960`, `PX_PER_MIN = 1`
- `hourMarks()`, `formatHour(min)`, `daySlotBlocks(day, index)`,
  `blockStyle(slot)` (absolute-position styles)
- `calendarDayRange(termKey)` → the term's standard rendered range (anchored,
  so an off-pattern early/late class never stretches the grid)
- `clipBand(band, range)` → the band's in-range portion with `clippedTop` /
  `clippedBottom` flags (or `null` when nothing falls inside the range)

### Display + filters

- `briefInstructor(name)`, `colorForDept(prefix)`, `colorForInstructor(name)`,
  `colorForSchedule(sid)` (deterministic palettes)
- `instructorSortKey(name)`, `compareInstructors`, `instructorsInSchedule(index)`,
  `departmentsInSchedule(index)`
- `buildFilter(mode, depts, instructors)` → `{ active, matches(item), color(item) }`
- `buildVisual(mode, depts, instructors, scheduleIds, colorSchedules)` →
  filter-first, then schedule coloring, else inactive

### Drag payload (shared with the planner timeline)

- `buildDragPayload(it, fromDay)` → serialized `{ sid, prefix, number, section, lab, labSeq, fromDay }`
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
