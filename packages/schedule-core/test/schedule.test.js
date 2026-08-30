import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WEEKDAYS,
  WEEKDAY_NAMES,
  SLOT_BLOCKS,
  toMinutes,
  formatTime,
  parseCsv,
  renderCsv,
  buildIndex,
  conflictsBetween,
  conflictsForCourse,
  instructorConflicts,
  slotKey,
  DAY_START_MIN,
  DAY_END_MIN,
  hourMarks,
  formatHour,
  daySlotBlocks,
  blockStyle,
  briefInstructor,
  colorForDept,
  colorForSchedule,
  buildFilter,
  buildVisual,
  buildEditVisual,
  proposeOverlay,
  instructorsInSchedule,
  departmentsInSchedule,
  moveOfferingSmart,
  rescheduleDays,
  updateOfferingInSchedule,
  DEFAULT_SLOT,
  nextSectionLetter,
  addOfferingToSchedule,
  removeOfferingFromSchedule,
  TERM_CONFIGS,
  TERM_KEYS,
  TERM_LABELS,
  termConfig,
  termSlotOptions,
  calendarDayRange,
} from '../schedule.js'

const CSV = [
  'dept-prefix,course-number,section,instructor,days,times',
  'CS,101,A,Vosmeier,MWF,9:20-10:30',
  'BIO,161,A,Patterson,MWF,9:20-10:30',
  'CS,201,A,Vosmeier,TR,8:00-9:45',
  'BIO,250,A,Patterson,MWF,13:20-14:30',
  'CS,101,B,Morgan,TR,10:00-11:45',
  'CS,210,A,Vosmeier,MWF,9:20-10:30',
].join('\n')

// ---------------------------------------------------------------------------
// Constants / time helpers
// ---------------------------------------------------------------------------

test('weekday constants', () => {
  assert.deepEqual(WEEKDAYS, ['M', 'T', 'W', 'R', 'F'])
  assert.equal(WEEKDAY_NAMES.M, 'Monday')
  assert.equal(WEEKDAY_NAMES.R, 'Thursday')
})

// ---------------------------------------------------------------------------
// Smart drag: day-set recomputation when moving between slots
// ---------------------------------------------------------------------------

test('rescheduleDays: different day group adopts the target group', () => {
  assert.equal(rescheduleDays('MW', 'M', 'TR', 'T'), 'TR')
  assert.equal(rescheduleDays('TR', 'T', 'MWF', 'M'), 'MWF')
})

test('rescheduleDays: same group, different time keeps current days', () => {
  assert.equal(rescheduleDays('MW', 'M', 'MWF', 'M'), 'MW')
  assert.equal(rescheduleDays('T', 'T', 'TR', 'T'), 'T')
})

test('rescheduleDays: same group, different day swaps the dragged day', () => {
  // MW 8:00-9:10 dragged from Monday onto Friday 9:20 -> WF 9:20-10:30
  assert.equal(rescheduleDays('MW', 'M', 'MWF', 'F'), 'WF')
  // dragging Wednesday's occurrence onto Friday drops W (already has F) -> MF
  assert.equal(rescheduleDays('MWF', 'W', 'MWF', 'F'), 'MF')
  // dragging the Tuesday occurrence onto Thursday collapses TR to R
  assert.equal(rescheduleDays('TR', 'T', 'TR', 'R'), 'R')
})

test('moveOfferingSmart reschedules using the drag context', () => {
  const offerings = [
    { prefix: 'CS', number: '101', section: 'A', instructor: 'Vosmeier', days: 'MW', time: '8:00-9:10' },
  ]
  const next = moveOfferingSmart(
    offerings,
    { prefix: 'CS', number: '101', section: 'A' },
    {
      fromDay: 'M',
      toDay: 'F',
      group: 'MWF',
      time: '9:20-10:30',
    },
  )
  assert.notEqual(next, offerings)
  assert.equal(next[0].days, 'WF')
  assert.equal(next[0].time, '9:20-10:30')
  assert.equal(next[0].instructor, 'Vosmeier')
  assert.equal(offerings[0].days, 'MW')
})

test('moveOfferingSmart returns the same array when nothing matches', () => {
  const offerings = [{ prefix: 'CS', number: '101', section: 'A', days: 'MW', time: '8:00-9:10' }]
  assert.equal(
    moveOfferingSmart(
      offerings,
      { prefix: 'BIO', number: '161', section: 'A' },
      {
        fromDay: 'M',
        toDay: 'T',
        group: 'TR',
        time: '8:00-9:45',
      },
    ),
    offerings,
  )
})

test('updateOfferingInSchedule rewrites instructor/section/days/time by current identity', () => {
  const offerings = [
    { prefix: 'CS', number: '101', section: 'A', instructor: 'Vosmeier', days: 'MWF', time: '9:20-10:30' },
    { prefix: 'BIO', number: '161', section: 'A', instructor: 'Patterson', days: 'MWF', time: '9:20-10:30' },
  ]
  const next = updateOfferingInSchedule(
    offerings,
    { prefix: 'CS', number: '101', section: 'A' },
    { instructor: 'Morgan', section: 'B', days: 'MW', time: '8:00-9:10' },
  )
  assert.notEqual(next, offerings)
  // located by the original section, then fully rewritten
  assert.equal(next[0].instructor, 'Morgan')
  assert.equal(next[0].section, 'B')
  assert.equal(next[0].days, 'MW')
  assert.equal(next[0].time, '8:00-9:10')
  // unrelated offerings untouched
  assert.equal(next[1].section, 'A')
  // original array untouched
  assert.equal(offerings[0].instructor, 'Vosmeier')
})

test('updateOfferingInSchedule returns the same array when nothing matches', () => {
  const offerings = [
    { prefix: 'CS', number: '101', section: 'A', instructor: 'Vosmeier', days: 'MWF', time: '9:20-10:30' },
  ]
  assert.equal(
    updateOfferingInSchedule(offerings, { prefix: 'CS', number: '999', section: 'A' }, { days: 'MW' }),
    offerings,
  )
})

test('DEFAULT_SLOT lands a new course in the first MWF band', () => {
  assert.equal(DEFAULT_SLOT.days, 'MWF')
  assert.equal(DEFAULT_SLOT.time, '8:00-9:10')
})

test('nextSectionLetter picks the first free section letter per course', () => {
  const offerings = [
    { prefix: 'CS', number: '101', section: 'A' },
    { prefix: 'CS', number: '101', section: 'B' },
    { prefix: 'BIO', number: '161', section: 'A' },
  ]
  assert.equal(nextSectionLetter(offerings, 'CS', '101'), 'C')
  assert.equal(nextSectionLetter(offerings, 'BIO', '161'), 'B')
  assert.equal(nextSectionLetter(offerings, 'MAT', '120'), 'A')
  // missing offerings array is treated as empty
  assert.equal(nextSectionLetter(undefined, 'MAT', '120'), 'A')
})

test('addOfferingToSchedule appends to the offerings array', () => {
  const offerings = [{ prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30' }]
  const added = { prefix: 'CS', number: '101', section: 'B', days: 'MWF', time: '8:00-9:10' }
  const next = addOfferingToSchedule(offerings, added)
  assert.notEqual(next, offerings)
  assert.equal(next.length, 2)
  assert.equal(next[1], added)
  assert.equal(offerings.length, 1)
})

test('removeOfferingFromSchedule drops the matched offering', () => {
  const offerings = [
    { prefix: 'CS', number: '101', section: 'A', instructor: 'Vosmeier', days: 'MWF', time: '9:20-10:30' },
    { prefix: 'CS', number: '101', section: 'B', instructor: 'Morgan', days: 'TR', time: '10:00-11:45' },
  ]
  const next = removeOfferingFromSchedule(offerings, { prefix: 'CS', number: '101', section: 'A' })
  assert.notEqual(next, offerings)
  assert.deepEqual(
    next.map((o) => o.section),
    ['B'],
  )
  assert.equal(offerings.length, 2)
})

test('removeOfferingFromSchedule returns the same array when nothing matches', () => {
  const offerings = [{ prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30' }]
  assert.equal(
    removeOfferingFromSchedule(offerings, { prefix: 'BIO', number: '161', section: 'A' }),
    offerings,
  )
})

test('toMinutes', () => {
  assert.equal(toMinutes('8:00'), 480)
  assert.equal(toMinutes('16:00'), 960)
  assert.equal(toMinutes('9:20'), 560)
})

test('formatTime converts to 12-hour ranges', () => {
  assert.equal(formatTime('8:00-9:10'), '8:00 AM - 9:10 AM')
  assert.equal(formatTime('13:20-14:30'), '1:20 PM - 2:30 PM')
})

test('slot blocks cover the working day', () => {
  assert.equal(SLOT_BLOCKS.length, 2)
  const all = SLOT_BLOCKS.flatMap((b) => b.slots)
  assert.ok(all.every((s) => s.start >= DAY_START_MIN && s.end <= DAY_END_MIN))
})

test('hour scale', () => {
  assert.equal(formatHour(480), '8a')
  assert.equal(formatHour(960), '4p')
  const marks = hourMarks()
  assert.equal(marks.length, (DAY_END_MIN - DAY_START_MIN) / 60 + 1)
  assert.equal(marks[0].label, '8a')
  assert.equal(marks[marks.length - 1].label, '4p')
})

test('slotKey', () => {
  assert.equal(slotKey('M', '8:00-9:10'), 'M|8:00-9:10')
})

// ---------------------------------------------------------------------------
// Parsing + index
// ---------------------------------------------------------------------------

test('parseCsv maps columns and trims', () => {
  const rows = parseCsv(CSV)
  assert.equal(rows.length, 6)
  assert.deepEqual(rows[0], {
    prefix: 'CS',
    number: '101',
    section: 'A',
    instructor: 'Vosmeier',
    days: 'MWF',
    time: '9:20-10:30',
  })
})

test('parseCsv skips blank lines', () => {
  const rows = parseCsv(
    'dept-prefix,course-number,section,instructor,days,times\n\nCS,101,A,Vosmeier,MWF,9:20-10:30\n\n',
  )
  assert.equal(rows.length, 1)
})

test('parseCsv accepts a `time` column synonym and blank times as unscheduled', () => {
  const rows = parseCsv('dept-prefix,course-number,section,instructor,days,time\nCS,220,A,Wahl,,\n')
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], {
    prefix: 'CS',
    number: '220',
    section: 'A',
    instructor: 'Wahl',
    days: '',
    time: '',
  })
})

test('parseCsv handles quoted fields with commas and quotes', () => {
  const rows = parseCsv(
    'dept-prefix,course-number,section,instructor,days,times\nCS,101,A,"O\'Brien, Jr.","M,W",9:20-10:30\n',
  )
  assert.equal(rows[0].instructor, "O'Brien, Jr.")
  assert.equal(rows[0].days, 'M,W')
})

test('parseCsv includes term only when the source has a term column', () => {
  const rows = parseCsv(
    'dept-prefix,course-number,section,instructor,days,times,term\nCS,101,A,Vosmeier,MWF,9:20-10:30,S\n',
  )
  assert.equal(rows[0].term, 'S')
})

test('renderCsv round-trips parseCsv output', () => {
  const rows = parseCsv(CSV)
  const csv = renderCsv(rows)
  assert.deepEqual(parseCsv(csv), rows)
})

test('renderCsv writes term only when present on an offering', () => {
  const csv = renderCsv([
    {
      prefix: 'CS',
      number: '101',
      section: 'A',
      instructor: 'Vosmeier',
      days: 'MWF',
      time: '9:20-10:30',
      term: 'S',
    },
  ])
  assert.ok(csv.startsWith('dept-prefix,course-number,section,instructor,days,times,term'))
  assert.ok(csv.includes(',S'))
})

test('buildIndex groups by course, day, slot, instructor', () => {
  const index = buildIndex(parseCsv(CSV))
  assert.equal(index.byCourse['CS 101'].length, 2)
  assert.equal(index.byCourse['BIO 161'].length, 1)

  const cs101a = index.byCourse['CS 101'].find((it) => it.o.section === 'A')
  assert.deepEqual(cs101a.days, ['M', 'W', 'F'])
  assert.equal(cs101a.code, 'CS 101')
  assert.equal(cs101a.start, 560)
  assert.equal(cs101a.end, 630)

  assert.equal(index.byDay.M.length, 4)
  assert.equal(index.bySlot[slotKey('M', '9:20-10:30')].length, 3)
  assert.equal(index.byInstructor.Vosmeier.length, 3)
  assert.equal(index.byInstructor.Patterson.length, 2)
})

test('daySlotBlocks groups a day into time slots', () => {
  const index = buildIndex(parseCsv(CSV))
  const blocks = daySlotBlocks('M', index)
  assert.equal(blocks.length, 2)
  assert.deepEqual(
    blocks.map((b) => b.time),
    ['9:20-10:30', '13:20-14:30'],
  )
  assert.equal(blocks[0].items.length, 3)
})

test('blockStyle positions absolutely', () => {
  assert.deepEqual(blockStyle({ start: 560, end: 630 }), { top: '80px', height: '70px' })
})

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

test('conflictsBetween detects overlaps on shared days', () => {
  const index = buildIndex(parseCsv(CSV))
  const a = index.byCourse['CS 101'].find((it) => it.o.section === 'A')
  const b = index.byCourse['BIO 161'][0]
  assert.equal(conflictsBetween(a, b), true)
})

test('conflictsBetween ignores overlapping times on different days', () => {
  const a = { days: ['M', 'W', 'F'], start: 560, end: 630 }
  const b = { days: ['T', 'R'], start: 560, end: 630 }
  assert.equal(conflictsBetween(a, b), false)
})

test('conflictsForCourse lists other conflicting courses', () => {
  const index = buildIndex(parseCsv(CSV))
  const conflicted = conflictsForCourse('CS 101', index)
  assert.ok(conflicted.includes('BIO 161'))
  assert.ok(!conflicted.includes('CS 101'))
})

test('conflictsForCourse returns empty when nothing overlaps', () => {
  const index = buildIndex(parseCsv(CSV))
  assert.deepEqual(conflictsForCourse('BIO 250', index), [])
})

test('instructorConflicts flags double-bookings', () => {
  const index = buildIndex(parseCsv(CSV))
  const conflicts = instructorConflicts(index)
  assert.ok(conflicts.some((c) => c.instructor === 'Vosmeier'))
  assert.ok(conflicts.every((c) => c.a.code !== c.b.code))
})

// ---------------------------------------------------------------------------
// Display + filters
// ---------------------------------------------------------------------------

test('briefInstructor reverses first initial', () => {
  assert.equal(briefInstructor('M. Vosmeier'), 'Vosmeier M')
  assert.equal(briefInstructor('Eiriksson'), 'Eiriksson')
  assert.equal(briefInstructor(''), '')
})

test('colorForDept returns a hex color', () => {
  assert.match(colorForDept('CS'), /^#[0-9a-f]{6}$/i)
})

test('instructorsInSchedule / departmentsInSchedule are sorted distinct', () => {
  const index = buildIndex(parseCsv(CSV))
  assert.deepEqual(instructorsInSchedule(index), ['Morgan', 'Patterson', 'Vosmeier'])
  assert.deepEqual(departmentsInSchedule(index), ['BIO', 'CS'])
})

test('buildFilter department mode', () => {
  const filter = buildFilter('dept', ['CS'], [])
  assert.equal(filter.active, true)
  assert.equal(filter.matches({ o: { prefix: 'CS' } }), true)
  assert.equal(filter.matches({ o: { prefix: 'BIO' } }), false)
  assert.equal(buildFilter('dept', [], []).active, false)
})

test('buildFilter instructor mode', () => {
  const filter = buildFilter('instructor', [], ['Vosmeier'])
  assert.equal(filter.active, true)
  assert.equal(filter.matches({ o: { instructor: 'Vosmeier' } }), true)
  assert.equal(filter.matches({ o: { instructor: 'Morgan' } }), false)
})

test('colorForSchedule returns a stable hex color per schedule', () => {
  assert.match(colorForSchedule('cs'), /^#[0-9a-f]{6}$/i)
  assert.equal(colorForSchedule('cs'), colorForSchedule('cs'))
})

test('buildIndex tags each item with its schedule id', () => {
  const offerings = parseCsv(CSV).map((o) => ({ ...o, $sid: 'demo' }))
  const index = buildIndex(offerings)
  assert.equal(index.byCourse['CS 101'][0].sid, 'demo')
  assert.equal(index.byDay.M[0].sid, 'demo')
})

test('buildVisual uses schedule coloring when multiple schedules are shown and it is on', () => {
  const v = buildVisual('dept', [], [], ['cs', 'bio'], true)
  assert.equal(v.active, true)
  assert.equal(v.matches({}), true)
  assert.match(v.color({ sid: 'cs' }), /^#[0-9a-f]{6}$/i)
  // color is deterministic per schedule
  assert.equal(v.color({ sid: 'bio' }), v.color({ sid: 'bio' }))
})

test('buildVisual skips schedule coloring when the toggle is off', () => {
  assert.equal(buildVisual('dept', [], [], ['cs', 'bio'], false).active, false)
})

test('buildVisual prefers a department/instructor filter over schedule coloring', () => {
  const v = buildVisual('dept', ['CS'], [], ['cs', 'bio'], true)
  assert.equal(v.active, true)
  assert.equal(v.color({ o: { prefix: 'CS' } }), colorForDept('CS'))
})

test('buildVisual uses schedule coloring for a single schedule too (shows the course list)', () => {
  const v = buildVisual('dept', [], [], ['cs'], true)
  assert.equal(v.active, true)
  assert.equal(v.color({ sid: 'cs' }), colorForSchedule('cs'))
})

test('buildVisual is inactive only when no schedule is shown or a filter is active', () => {
  assert.equal(buildVisual('dept', [], [], [], true).active, false)
  // colorSchedules off → inactive even with schedules present
  assert.equal(buildVisual('dept', [], [], ['cs'], false).active, false)
  // a filter takes precedence over schedule coloring
  assert.equal(buildVisual('dept', ['CS'], [], ['cs'], true).active, true)
  assert.equal(
    buildVisual('dept', ['CS'], [], ['cs'], true).color({ o: { prefix: 'CS' } }),
    colorForDept('CS'),
  )
})

// ---------------------------------------------------------------------------
// Term configs + calendar range
// ---------------------------------------------------------------------------

test('term configs: F/W share the standard groups, S has one MTWRF group', () => {
  assert.deepEqual(TERM_KEYS, ['F', 'W', 'S'])
  assert.equal(TERM_CONFIGS.length, 3)
  assert.equal(TERM_LABELS.F, 'Fall')
  assert.equal(TERM_LABELS.S, 'Spring')
  assert.deepEqual(termConfig('F').dayGroups, SLOT_BLOCKS)
  assert.deepEqual(termConfig('W').dayGroups, SLOT_BLOCKS)
  assert.equal(termConfig('S').dayGroups.length, 1)
  assert.equal(termConfig('S').dayGroups[0].label, 'MTWRF')
  assert.equal(termConfig('S').maxConsecutiveSlots, 2)
  // unknown key falls back to Fall
  assert.equal(termConfig('Z').key, 'F')
})

test('spring has 4 base slots across the day', () => {
  const spring = termConfig('S')
  const slots = spring.dayGroups[0].slots
  assert.equal(slots.length, 4)
  assert.deepEqual(
    slots.map((s) => s.time),
    ['8:00-10:15', '10:15-12:30', '12:30-14:45', '14:45-17:00'],
  )
})

test('termSlotOptions yields base slots for maxConsecutiveSlots 1 (F/W)', () => {
  const mondayMWF = termSlotOptions('F', 'M')
  assert.deepEqual(
    mondayMWF.map((s) => s.time),
    ['8:00-9:10', '9:20-10:30', '10:40-11:50', '12:00-13:10', '13:20-14:30', '14:40-15:50'],
  )
  // Tuesday falls in the TR group
  assert.deepEqual(
    termSlotOptions('F', 'T').map((s) => s.time),
    ['8:00-9:45', '10:00-11:45', '12:20-14:05', '14:15-16:00'],
  )
})

test('spring termSlotOptions includes consecutive pairs', () => {
  const m = termSlotOptions('S', 'M')
  assert.deepEqual(
    m.map((s) => s.time),
    ['8:00-10:15', '8:00-12:30', '10:15-12:30', '10:15-14:45', '12:30-14:45', '12:30-17:00', '14:45-17:00'],
  )
  // every day has the same options in spring
  assert.deepEqual(termSlotOptions('S', 'W'), m)
})

test('termSlotOptions returns empty for a day not in the group', () => {
  assert.deepEqual(termSlotOptions('F', 'S'), [])
})

test('rescheduleDays uses the term day groups for a spring course', () => {
  // A spring course dragged within its single MTWRF group keeps/sets that group.
  assert.equal(rescheduleDays('', 'M', 'MTWRF', 'T', 'S'), 'MTWRF')
  // swapping a specific day within the group
  assert.equal(rescheduleDays('MTWR', 'M', 'MTWRF', 'F', 'S'), 'TWRF')
})

test('calendarDayRange expands to arbitrary early/late times', () => {
  const index = buildIndex([
    { prefix: 'CS', number: '220', section: 'A', days: 'MWF', time: '8:00-9:10' },
    { prefix: 'BIO', number: '410', section: 'A', days: 'MWF', time: '20:00-21:30' },
  ])
  const range = calendarDayRange(index)
  assert.equal(range.start, 480)
  assert.equal(range.end, 1290)
  // empty index falls back to the standard range
  assert.deepEqual(calendarDayRange(buildIndex([])), { start: DAY_START_MIN, end: DAY_END_MIN })
})

test('unscheduled offerings are excluded from calendar and conflicts', () => {
  const index = buildIndex([
    { prefix: 'CS', number: '220', section: 'A', days: '', time: '', instructor: 'Wahl' },
    { prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30', instructor: 'Vosmeier' },
  ])
  // still grouped by course and instructor
  assert.equal(index.byCourse['CS 220'].length, 1)
  assert.equal(index.byInstructor.Wahl.length, 1)
  // but not placed on any day/slot and listed as unscheduled
  assert.equal(index.byDay.M.length, 1)
  assert.deepEqual(
    index.unscheduled.map((it) => it.code),
    ['CS 220'],
  )
  assert.deepEqual(conflictsForCourse('CS 220', index), [])
})

test('buildEditVisual keeps every course visible but honors an active filter', () => {
  // No filter: pass-all, colored by the edit color callback.
  const open = buildEditVisual('dept', [], [], (it) => '#' + it.sid)
  assert.equal(open.active, true)
  assert.equal(open.matches({ o: { prefix: 'BIO' } }), true)
  assert.equal(open.color({ sid: 'cs' }), '#cs')

  // Active department filter: limits AND colors by department.
  const dept = buildEditVisual('dept', ['CS'], [], () => '#x')
  assert.equal(dept.active, true)
  assert.equal(dept.matches({ o: { prefix: 'CS' } }), true)
  assert.equal(dept.matches({ o: { prefix: 'BIO' } }), false)
  assert.equal(dept.color({ o: { prefix: 'CS' } }), colorForDept('CS'))

  // Active instructor filter behaves the same.
  const inst = buildEditVisual('instructor', [], ['Vosmeier'], () => '#x')
  assert.equal(inst.matches({ o: { instructor: 'Vosmeier' } }), true)
  assert.equal(inst.matches({ o: { instructor: 'Morgan' } }), false)
})

test('proposeOverlay renders concurrent proposals independently with proposers', () => {
  const base = [
    { prefix: 'PHY', number: '121', section: 'A', days: 'MWF', time: '9:20-10:30' },
    { prefix: 'MAT', number: '131', section: 'A', days: 'TR', time: '10:00-11:45' },
    { prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '8:00-9:10' },
  ]
  const pending = [
    {
      id: 7,
      proposer: 'physics',
      operations: [
        {
          kind: 'update',
          cur: { prefix: 'PHY', number: '121', section: 'A' },
          changes: { days: 'MWF', time: '12:00-13:10' },
        },
      ],
    },
    {
      id: 9,
      proposer: 'math',
      operations: [
        {
          kind: 'update',
          cur: { prefix: 'MAT', number: '131', section: 'A' },
          changes: { days: 'TR', time: '14:15-16:00' },
        },
        {
          kind: 'add',
          offering: { prefix: 'MAT', number: '299', section: 'A', days: 'MWF', time: '8:00-9:10' },
        },
      ],
    },
    {
      id: 11,
      proposer: 'math',
      operations: [{ kind: 'remove', cur: { prefix: 'CS', number: '101', section: 'A' } }],
    },
    {
      id: 14,
      proposer: 'registrar',
      operations: [
        // instructor-only change: no calendar overlay
        {
          kind: 'update',
          cur: { prefix: 'CS', number: '101', section: 'A' },
          changes: { instructor: 'Wahl' },
        },
      ],
    },
  ]
  const { proposed, removals } = proposeOverlay(base, pending)
  assert.equal(proposed.length, 3) // two moves + one add; instructor-only skipped
  const phy = proposed.find((p) => p.offering.prefix === 'PHY')
  assert.equal(phy.kind, 'move')
  assert.equal(phy.offering.time, '12:00-13:10')
  assert.deepEqual(phy.from, { prefix: 'PHY', number: '121', section: 'A' })
  assert.equal(phy.proposer, 'physics')
  assert.equal(phy.suggestionId, 7)
  const added = proposed.find((p) => p.kind === 'add')
  assert.equal(added.offering.number, '299')
  assert.deepEqual(removals, [
    { cur: { prefix: 'CS', number: '101', section: 'A' }, suggestionId: 11, proposer: 'math' },
  ])
})
