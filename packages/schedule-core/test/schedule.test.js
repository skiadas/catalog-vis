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
  isStandardPattern,
  calendarDayRange,
  clipBand,
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

test('updateOfferingInSchedule normalizes half-set meeting times to no-meeting-time', () => {
  const offerings = [
    { prefix: 'CS', number: '101', section: 'A', instructor: 'Vosmeier', days: 'MWF', time: '9:20-10:30' },
  ]
  // wiping one side blanks the other too — a half-set record can never
  // survive a write; both-blank is the contract's no-meeting-time shape.
  const timeWiped = updateOfferingInSchedule(
    offerings,
    { prefix: 'CS', number: '101', section: 'A' },
    { time: '' },
  )
  assert.equal(timeWiped[0].days, '')
  assert.equal(timeWiped[0].time, '')
  const daysWiped = updateOfferingInSchedule(
    offerings,
    { prefix: 'CS', number: '101', section: 'A' },
    { days: '' },
  )
  assert.equal(daysWiped[0].days, '')
  assert.equal(daysWiped[0].time, '')
  // a fully-set change passes through untouched
  const full = updateOfferingInSchedule(
    offerings,
    { prefix: 'CS', number: '101', section: 'A' },
    { days: 'TR', time: '10:00-11:45' },
  )
  assert.equal(full[0].days, 'TR')
  assert.equal(full[0].time, '10:00-11:45')
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

// ---------------------------------------------------------------------------
// Lab sections: identity, cascades, grouping
// ---------------------------------------------------------------------------

const LAB_TERM = [
  { prefix: 'BIO', number: '166', section: 'A', instructor: 'Patterson', days: 'MWF', time: '9:20-10:30' },
  { prefix: 'BIO', number: '166', section: 'B', instructor: 'Patterson', days: 'MWF', time: '12:00-13:10' },
  {
    prefix: 'BIO',
    number: '166',
    section: 'A',
    instructor: 'Doe',
    days: 'TR',
    time: '10:00-11:45',
    lab: true,
    labSeq: 1,
  },
  {
    prefix: 'BIO',
    number: '166',
    section: 'A',
    instructor: 'Doe',
    days: 'W',
    time: '13:20-14:30',
    lab: true,
    labSeq: 2,
  },
]

test('updateOfferingInSchedule targets a lab row, never the lecture it mirrors', () => {
  const updated = updateOfferingInSchedule(
    LAB_TERM,
    { prefix: 'BIO', number: '166', section: 'A', lab: true, labSeq: 2 },
    { instructor: 'Eiriksson', days: 'TR', time: '14:15-16:00' },
  )
  const lecture = updated.find((o) => !o.lab && o.section === 'A')
  assert.equal(lecture.instructor, 'Patterson')
  const lab2 = updated.find((o) => o.lab && o.labSeq === 2)
  assert.equal(lab2.instructor, 'Eiriksson')
  assert.equal(lab2.time, '14:15-16:00')
  const lab1 = updated.find((o) => o.lab && o.labSeq === 1)
  assert.equal(lab1.time, '10:00-11:45')
})

test('updateOfferingInSchedule cascades a lecture section-letter rename to its labs', () => {
  const updated = updateOfferingInSchedule(
    LAB_TERM,
    { prefix: 'BIO', number: '166', section: 'A' },
    { section: 'C' },
  )
  const lecture = updated.find((o) => !o.lab && o.section === 'C')
  assert.equal(lecture.section, 'C')
  const labs = updated.filter((o) => o.lab && o.section === 'C')
  assert.equal(labs.length, 2)
  // the section B lecture and its (absent) labs are untouched
  assert.ok(updated.some((o) => !o.lab && o.section === 'B'))
})

test('updateOfferingInSchedule renames labs onto free sequences when the target letter already has labs', () => {
  const offerings = [
    ...LAB_TERM.slice(0, 2),
    {
      prefix: 'BIO',
      number: '166',
      section: 'B',
      instructor: 'Doe',
      days: 'TR',
      time: '10:00-11:45',
      lab: true,
      labSeq: 1,
    },
    {
      prefix: 'BIO',
      number: '166',
      section: 'A',
      instructor: 'Doe',
      days: 'W',
      time: '13:20-14:30',
      lab: true,
      labSeq: 1,
    },
  ]
  const updated = updateOfferingInSchedule(
    offerings,
    { prefix: 'BIO', number: '166', section: 'A' },
    { section: 'B' },
  )
  const labSeqs = updated.filter((o) => o.lab && o.section === 'B').map((o) => o.labSeq)
  // B's own lab keeps 1; A's lab lands on 2 — distinct identities
  assert.deepEqual(labSeqs.sort(), [1, 2])
})

test('removeOfferingFromSchedule removes a lecture and its labs together', () => {
  const next = removeOfferingFromSchedule(LAB_TERM, { prefix: 'BIO', number: '166', section: 'A' })
  const sections = next.map((o) => o.section)
  assert.deepEqual(sections, ['B'])
})

test('removeOfferingFromSchedule removes a single lab without touching its lecture', () => {
  const next = removeOfferingFromSchedule(LAB_TERM, {
    prefix: 'BIO',
    number: '166',
    section: 'A',
    lab: true,
    labSeq: 1,
  })
  assert.equal(next.length, 3)
  assert.equal(next.filter((o) => o.lab).length, 1)
  assert.equal(
    next.some((o) => !o.lab),
    true,
  )
})

test('moveOfferingSmart moves a lab, not the lecture with the same section letter', () => {
  const next = moveOfferingSmart(
    LAB_TERM,
    { prefix: 'BIO', number: '166', section: 'A', lab: true, labSeq: 1 },
    { fromDay: 'T', toDay: 'R', group: 'TR', time: '14:15-16:00' },
  )
  const lab1 = next.find((o) => o.lab && o.labSeq === 1)
  assert.equal(lab1.time, '14:15-16:00')
  const lecture = next.find((o) => !o.lab && o.section === 'A')
  assert.equal(lecture.time, '9:20-10:30')
})

test('nextSectionLetter ignores lab rows when choosing a lecture letter', () => {
  assert.equal(nextSectionLetter(LAB_TERM, 'BIO', '166'), 'C')
})

test('buildIndex groups labs under the parent course with lab labels', () => {
  const index = buildIndex(LAB_TERM)
  const items = index.byCourse['BIO 166']
  assert.equal(items.length, 4)
  const labs = items.filter((it) => it.lab)
  assert.equal(labs.length, 2)
  assert.deepEqual(
    labs.map((it) => it.sectionLabel),
    ['Lab A', 'Lab A \u00b7 2'],
  )
  const lecture = items.find((it) => !it.lab && it.o.section === 'A')
  assert.equal(lecture.sectionLabel, 'Section A')
})

test('a lecture and its own labs never conflict; another course does', () => {
  const index = buildIndex(LAB_TERM)
  assert.deepEqual(conflictsForCourse('BIO 166', index), [])
  // a second course overlapping lab 2's Wednesday slot flags BIO 166
  const other = buildIndex([
    ...LAB_TERM,
    { prefix: 'CS', number: '101', section: 'A', instructor: 'Vosmeier', days: 'W', time: '13:20-14:30' },
  ])
  assert.deepEqual(conflictsForCourse('BIO 166', other), ['CS 101'])
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

test('formatTime renders a blank time as "No meeting time"', () => {
  assert.equal(formatTime(''), 'No meeting time')
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

test('parseCsv treats literal NULL and blank meeting cells as unscheduled', () => {
  const rows = parseCsv(
    [
      'dept-prefix,course-number,section,instructor,days,times',
      'CS,220,A,Wahl,NULL,NULL',
      'BIO,161,A,Patterson,MWF,NULL',
      'MAT,120,A,Doe,,""',
      'PHY,121,A,Smith,,',
    ].join('\n'),
  )
  assert.equal(rows.length, 4)
  for (const r of rows) {
    assert.equal(r.days, '')
    assert.equal(r.time, '')
  }
})

test('parseCsv lab rows normalize the trailing L off the number', () => {
  const rows = parseCsv(
    'dept-prefix,course-number,section,instructor,days,times\nBIO,166L,A,Patterson,TR,10:00-11:45\n',
  )
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], {
    prefix: 'BIO',
    number: '166',
    section: 'A',
    instructor: 'Patterson',
    days: 'TR',
    time: '10:00-11:45',
    lab: true,
    labSeq: 1,
  })
})

test('parseCsv numbers duplicate lab rows deterministically (first-seen order)', () => {
  const rows = parseCsv(
    [
      'dept-prefix,course-number,section,instructor,days,times',
      'BIO,166,A,Patterson,MWF,9:20-10:30',
      'BIO,166L,A,Doe,TR,10:00-11:45',
      'BIO,166L,A,Doe,W,13:20-14:30',
    ].join('\n'),
  )
  const labs = rows.filter((r) => r.lab)
  assert.deepEqual(
    labs.map((l) => l.labSeq),
    [1, 2],
  )
  assert.deepEqual(
    labs.map((l) => l.section),
    ['A', 'A'],
  )
})

test('parseCsv honors an explicit sequence digit on a lab number', () => {
  const rows = parseCsv(
    'dept-prefix,course-number,section,instructor,days,times\nBIO,166L2,A,Doe,TR,10:00-11:45\n',
  )
  assert.equal(rows[0].lab, true)
  assert.equal(rows[0].labSeq, 2)
  // mixed explicit + implicit rows stay distinct and stable
  const mixed = parseCsv(
    [
      'dept-prefix,course-number,section,instructor,days,times',
      'BIO,166L2,A,Doe,TR,10:00-11:45',
      'BIO,166L,A,Doe,W,13:20-14:30',
    ].join('\n'),
  )
  assert.deepEqual(
    mixed.filter((r) => r.lab).map((l) => l.labSeq),
    [2, 1],
  )
})

test('renderCsv writes lab numbers back in the registrar shape', () => {
  const csv = renderCsv([
    { prefix: 'BIO', number: '166', section: 'A', instructor: 'Patterson', days: 'MWF', time: '9:20-10:30' },
    {
      prefix: 'BIO',
      number: '166',
      section: 'A',
      instructor: 'Doe',
      days: 'TR',
      time: '10:00-11:45',
      lab: true,
      labSeq: 1,
    },
    {
      prefix: 'BIO',
      number: '166',
      section: 'A',
      instructor: 'Doe',
      days: 'W',
      time: '13:20-14:30',
      lab: true,
      labSeq: 2,
    },
  ])
  const lines = csv.split('\n')
  assert.ok(lines[1].startsWith('BIO,166,A'))
  assert.ok(lines[2].startsWith('BIO,166L,A'))
  assert.ok(lines[3].startsWith('BIO,166L2,A'))
  // the round-trip is stable
  assert.deepEqual(parseCsv(csv), [
    { prefix: 'BIO', number: '166', section: 'A', instructor: 'Patterson', days: 'MWF', time: '9:20-10:30' },
    {
      prefix: 'BIO',
      number: '166',
      section: 'A',
      instructor: 'Doe',
      days: 'TR',
      time: '10:00-11:45',
      lab: true,
      labSeq: 1,
    },
    {
      prefix: 'BIO',
      number: '166',
      section: 'A',
      instructor: 'Doe',
      days: 'W',
      time: '13:20-14:30',
      lab: true,
      labSeq: 2,
    },
  ])
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

test('calendarDayRange is anchored to the term, not to offerings', () => {
  // Fall/Winter rule 8:00-16:00; Spring 8:00-17:00. An early/late class does
  // not stretch the rendered range — off-pattern classes are clamped instead.
  assert.deepEqual(calendarDayRange('F'), { start: 480, end: 960 })
  assert.deepEqual(calendarDayRange('W'), { start: 480, end: 960 })
  assert.deepEqual(calendarDayRange('S'), { start: 480, end: 1020 })
})

test('clipBand keeps only the in-range portion of an off-pattern band', () => {
  const range = calendarDayRange('F') // 8:00-16:00
  // fully inside: passthrough, no clipped edges
  assert.deepEqual(clipBand({ start: 600, end: 705 }, range), {
    start: 600,
    end: 705,
    clippedTop: false,
    clippedBottom: false,
  })
  // starts before the ruled hours
  assert.deepEqual(clipBand({ start: 420, end: 550 }, range), {
    start: 480,
    end: 550,
    clippedTop: true,
    clippedBottom: false,
  })
  // ends after the ruled hours
  assert.deepEqual(clipBand({ start: 880, end: 1140 }, range), {
    start: 880,
    end: 960,
    clippedTop: false,
    clippedBottom: true,
  })
  // entirely outside: nothing to render
  assert.equal(clipBand({ start: 1100, end: 1260 }, range), null)
  assert.equal(clipBand({ start: 300, end: 420 }, range), null)
})

test('isStandardPattern flags term bands and rejects off-pattern times', () => {
  // full groups at their own bands are standard
  assert.equal(isStandardPattern('F', 'MWF', '10:40-11:50'), true)
  assert.equal(isStandardPattern('F', 'TR', '10:00-11:45'), true)
  // a TR band on MWF days is not a MWF pattern (the switch-without-repick bug)
  assert.equal(isStandardPattern('F', 'MWF', '10:00-11:45'), false)
  assert.equal(isStandardPattern('F', 'TR', '10:40-11:50'), false)
  // day subsets still count when the time is a band of the day's group
  assert.equal(isStandardPattern('F', 'MW', '10:40-11:50'), true)
  // mixed day groups or blank days/time are off-pattern
  assert.equal(isStandardPattern('F', 'MT', '8:00-9:10'), false)
  assert.equal(isStandardPattern('F', '', '10:00-11:45'), false)
  assert.equal(isStandardPattern('F', 'MWF', ''), false)
  // spring bands (incl. consecutive pairs) count; a fall band does not
  assert.equal(isStandardPattern('S', 'MTWRF', '8:00-12:30'), true)
  assert.equal(isStandardPattern('S', 'MTWRF', '8:00-9:10'), false)
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
  assert.deepEqual(phy.from, {
    prefix: 'PHY',
    number: '121',
    section: 'A',
    lab: undefined,
    labSeq: undefined,
  })
  assert.equal(phy.proposer, 'physics')
  assert.equal(phy.suggestionId, 7)
  const added = proposed.find((p) => p.kind === 'add')
  assert.equal(added.offering.number, '299')
  assert.deepEqual(removals, [
    { cur: { prefix: 'CS', number: '101', section: 'A' }, suggestionId: 11, proposer: 'math' },
  ])
})
