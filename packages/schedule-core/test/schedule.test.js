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
  offeringIdFor,
  assignOfferingIds,
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
  instructorsOf,
  instructorChip,
  colorForDept,
  colorForInstructor,
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
  normalizeBand,
  calendarDayRange,
  clipBand,
  assignLanes,
  dayTimelineRange,
} from '../schedule.js'

const CSV = [
  'dept_prefix,course_number,course_section,instructor,days,times',
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
    ['Lab A1', 'Lab A2'],
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
    secondaryInstructors: [],
    days: 'MWF',
    time: '9:20-10:30',
    id: offeringIdFor({ prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30' }),
  })
})

test('parseCsv skips blank lines', () => {
  const rows = parseCsv(
    'dept_prefix,course_number,course_section,instructor,days,times\n\nCS,101,A,Vosmeier,MWF,9:20-10:30\n\n',
  )
  assert.equal(rows.length, 1)
})

test('parseCsv accepts a `time` column synonym and blank times as unscheduled', () => {
  const rows = parseCsv('dept_prefix,course_number,course_section,instructor,days,time\nCS,220,A,Wahl,,\n')
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], {
    prefix: 'CS',
    number: '220',
    section: 'A',
    instructor: 'Wahl',
    secondaryInstructors: [],
    days: '',
    time: '',
    id: offeringIdFor({ prefix: 'CS', number: '220', section: 'A', days: '', time: '' }),
  })
})

test('parseCsv handles quoted fields with commas and quotes', () => {
  const rows = parseCsv(
    'dept_prefix,course_number,course_section,instructor,days,times\nCS,101,A,"O\'Brien, Jr.","M,W",9:20-10:30\n',
  )
  assert.equal(rows[0].instructor, "O'Brien, Jr.")
  assert.equal(rows[0].days, 'M,W')
})

test('parseCsv includes term only when the source has a term column', () => {
  const rows = parseCsv(
    'dept_prefix,course_number,course_section,instructor,days,times,term\nCS,101,A,Vosmeier,MWF,9:20-10:30,S\n',
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
  assert.ok(
    csv.startsWith('dept_prefix,course_number,course_section,instructor,secondary_instr,days,times,term'),
  )
  assert.ok(csv.includes(',S'))
})

test('parseCsv reads the secondary_instr column into a names array', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,secondary_instr,days,times',
      'BIO,161,A,Patterson,Xu,MWF,8:00-9:10',
      'CS,101,A,Vosmeier,"Nguyen, Wu",TR,10:00-11:45',
      'MAT,120,A,Doe,,MWF,9:20-10:30',
    ].join('\n'),
  )
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0].secondaryInstructors, ['Xu'])
  // A quoted comma+space cell splits back into separate secondary instructors.
  assert.deepEqual(rows[1].secondaryInstructors, ['Nguyen', 'Wu'])
  assert.deepEqual(rows[2].secondaryInstructors, [])
})

test('parseCsv secondary_instr dedupes and tolerates whitespace around commas', () => {
  const [row] = parseCsv(
    'dept_prefix,course_number,course_section,instructor,secondary_instr,days,times\n' +
      'BIO,161,A,Patterson,"Xu, Xu , Barker",MWF,8:00-9:10\n',
  )
  assert.deepEqual(row.secondaryInstructors, ['Xu', 'Barker'])
})

test('parseCsv treats literal NULL in the instructor columns as no instructor', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,secondary_instr,days,times',
      'CS,220,A,NULL,,MWF,9:20-10:30',
      'BIO,161,A,Patterson,NULL,MWF,8:00-9:10',
      'MAT,120,A,Smith,"Xu, NULL",TR,10:00-11:45',
    ].join('\n'),
  )
  assert.equal(rows[0].instructor, '', 'NULL lead collapses to empty')
  assert.deepEqual(rows[1].secondaryInstructors, [], 'NULL secondary cell collapses to empty')
  assert.deepEqual(rows[2].secondaryInstructors, ['Xu'], 'NULL token inside a list is dropped')
})

test('renderCsv writes secondary_instr quoted and round-trips it', () => {
  const rows = parseCsv(
    'dept_prefix,course_number,course_section,instructor,secondary_instr,days,times\n' +
      'BIO,161,A,Patterson,"Xu, Ray",MWF,8:00-9:10\n',
  )
  const csv = renderCsv(rows)
  assert.ok(csv.includes('"Xu, Ray"'))
  assert.deepEqual(parseCsv(csv), rows)
})

test('parseCsv treats literal NULL and blank meeting cells as unscheduled', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times',
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

test('parseCsv lab rows normalize the trailing L off the number and read the sequence from the section cell', () => {
  const rows = parseCsv(
    'dept_prefix,course_number,course_section,instructor,days,times\nBIO,166L,A1,Patterson,TR,10:00-11:45\n',
  )
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], {
    prefix: 'BIO',
    number: '166',
    section: 'A',
    instructor: 'Patterson',
    secondaryInstructors: [],
    days: 'TR',
    time: '10:00-11:45',
    lab: true,
    labSeq: 1,
    id: offeringIdFor({
      prefix: 'BIO',
      number: '166',
      section: 'A',
      lab: true,
      labSeq: 1,
      days: 'TR',
      time: '10:00-11:45',
    }),
  })
})

test('parseCsv reads lab section digits (multi-digit included, letters case-insensitive)', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times',
      'BIO,166L,A2,Doe,TR,10:00-11:45',
      'CHE,120l,b10,Morgan,MWF,8:00-9:10',
    ].join('\n'),
  )
  const labs = rows.filter((r) => r.lab)
  assert.deepEqual(
    labs.map((l) => [l.number, l.section, l.labSeq]),
    [
      ['166', 'A', 2],
      ['120', 'b', 10],
    ],
  )
})

test('parseCsv lectures keep their section verbatim — digits never make a lecture a lab', () => {
  const rows = parseCsv(
    'dept_prefix,course_number,course_section,instructor,days,times\nBIO,166,A2,Patterson,TR,10:00-11:45\n',
  )
  assert.equal(rows[0].lab, undefined)
  assert.equal(rows[0].number, '166')
  assert.equal(rows[0].section, 'A2')
})

test('parseCsv renumbers colliding lab rows deterministically (first-seen order)', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times',
      'BIO,166,A,Patterson,MWF,9:20-10:30',
      'BIO,166L,A1,Doe,TR,10:00-11:45',
      'BIO,166L,A1,Doe,W,13:20-14:30',
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

test('parseCsv does not treat the legacy 166L2 number shape as a lab', () => {
  const rows = parseCsv(
    'dept_prefix,course_number,course_section,instructor,days,times\nBIO,166L2,A,Doe,TR,10:00-11:45\n',
  )
  assert.equal(rows[0].lab, undefined)
  assert.equal(rows[0].number, '166L2')
  assert.equal(rows[0].section, 'A')
})

test('renderCsv writes lab numbers and sections back in the registrar shape', () => {
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
  assert.ok(lines[2].startsWith('BIO,166L,A1'))
  assert.ok(lines[3].startsWith('BIO,166L,A2'))
  // the round-trip is stable
  assert.deepEqual(parseCsv(csv), [
    {
      prefix: 'BIO',
      number: '166',
      section: 'A',
      instructor: 'Patterson',
      secondaryInstructors: [],
      days: 'MWF',
      time: '9:20-10:30',
      id: offeringIdFor({ prefix: 'BIO', number: '166', section: 'A', days: 'MWF', time: '9:20-10:30' }),
    },
    {
      prefix: 'BIO',
      number: '166',
      section: 'A',
      instructor: 'Doe',
      secondaryInstructors: [],
      days: 'TR',
      time: '10:00-11:45',
      lab: true,
      labSeq: 1,
      id: offeringIdFor({
        prefix: 'BIO',
        number: '166',
        section: 'A',
        lab: true,
        labSeq: 1,
        days: 'TR',
        time: '10:00-11:45',
      }),
    },
    {
      prefix: 'BIO',
      number: '166',
      section: 'A',
      instructor: 'Doe',
      secondaryInstructors: [],
      days: 'W',
      time: '13:20-14:30',
      lab: true,
      labSeq: 2,
      id: offeringIdFor({
        prefix: 'BIO',
        number: '166',
        section: 'A',
        lab: true,
        labSeq: 2,
        days: 'W',
        time: '13:20-14:30',
      }),
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

test('daySlotBlocks splits a band that mixes standard and off-pattern courses', () => {
  const index = buildIndex([
    { prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '10:40-11:50', instructor: 'Vosmeier' },
    // An MR weekday set at an exact MWF band: off-pattern, sharing the band.
    { prefix: 'BIO', number: '161', section: 'A', days: 'MR', time: '10:40-11:50', instructor: 'Patterson' },
    // A genuine spanning custom in the same column (M) at another band.
    { prefix: 'MAT', number: '131', section: 'A', days: 'MWF', time: '8:00-10:30', instructor: 'Aydogan' },
  ])
  const blocks = daySlotBlocks('M', index, 'F')
  const atBand = blocks.filter((b) => b.time === '10:40-11:50')
  assert.equal(atBand.length, 2, 'mixed band splits into standard block + rail')
  const std = atBand.find((b) => !b.offPattern)
  const rail = atBand.find((b) => b.offPattern)
  assert.deepEqual(
    std.items.map((it) => it.o.prefix),
    ['CS'],
  )
  assert.deepEqual(
    rail.items.map((it) => it.o.prefix),
    ['BIO'],
    'the rail holds only the off-pattern course',
  )
  assert.equal(rail.sameSpan, true, 'squeezed rail marks its exact overlap')
  assert.equal(std.sameSpan, false)
  // Spanning custom: its own off-pattern block, never merged with the band.
  const spanning = blocks.find((b) => b.time === '8:00-10:30')
  assert.equal(spanning.offPattern, true)
  assert.equal(spanning.sameSpan, false)
  // Sorted by start, longer spans first (contained rails paint on top).
  assert.equal(blocks[0].time, '8:00-10:30')
})

test('blockStyle positions absolutely at the shared px-per-minute scale', () => {
  assert.deepEqual(blockStyle({ start: 560, end: 630 }), { top: '120px', height: '105px' })
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

// WCAG contrast ratio of a hex color against white (assumes text on an
// opaque chip). The palettes are rendered with white text as small as 10px,
// so AA normal-text (4.5:1) is the bar.
function luminance(hex) {
  const ch = hex
    .slice(1)
    .match(/../g)
    .map((p) => parseInt(p, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
function contrastVsWhite(hex) {
  return (1.05 / (luminance(hex) + 0.05)).toFixed(2)
}

test('every department palette color clears WCAG AA against white text', () => {
  const prefixes = [
    'AA',
    'BB',
    'CC',
    'DD',
    'EE',
    'FF',
    'GG',
    'HH',
    'II',
    'JJ',
    'KK',
    'LL',
    'MM',
    'NN',
    'OO',
    'PP',
    'QQ',
    'RR',
    'SS',
    'TT',
  ]
  const failures = []
  for (const p of prefixes) {
    const hex = colorForDept(p)
    const ratio = Number(contrastVsWhite(hex))
    if (ratio < 4.5) failures.push(`${p}: ${hex} = ${ratio}:1`)
  }
  assert.deepEqual(failures, [], 'palette entries under 4.5:1 against white')
})

test('every schedule palette color clears WCAG AA against white text', () => {
  const failures = []
  for (let i = 1; i <= 8; i++) {
    const hex = colorForSchedule(`sch-${i}`)
    const ratio = Number(contrastVsWhite(hex))
    if (ratio < 4.5) failures.push(`sch-${i}: ${hex} = ${ratio}:1`)
  }
  assert.deepEqual(failures, [], 'schedule palette entries under 4.5:1 against white')
})

test('instructor palette colors clear WCAG AA against white text', () => {
  const failures = []
  for (let i = 1; i <= 20; i++) {
    const hex = colorForInstructor(`Instructor ${i}`)
    const ratio = Number(contrastVsWhite(hex))
    if (ratio < 4.5) failures.push(`Instructor ${i}: ${hex} = ${ratio}:1`)
  }
  assert.deepEqual(failures, [], 'instructor palette entries under 4.5:1 against white')
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
  assert.equal(filter.matches({ o: { instructor: 'Vosmeier' }, instructors: ['Vosmeier'] }), true)
  assert.equal(filter.matches({ o: { instructor: 'Morgan' }, instructors: ['Morgan'] }), false)
})

test('instructorsOf normalizes lead + secondary into a distinct list', () => {
  assert.deepEqual(instructorsOf({ instructor: 'Patterson', secondaryInstructors: ['Xu', 'Ray'] }), [
    'Patterson',
    'Xu',
    'Ray',
  ])
  // A person listed as both lead and secondary appears once; an absent
  // secondaryInstructors (older records) reads as empty.
  assert.deepEqual(instructorsOf({ instructor: 'Xu', secondaryInstructors: ['Xu', 'Ray'] }), ['Xu', 'Ray'])
  assert.deepEqual(instructorsOf({ instructor: 'Wahl' }), ['Wahl'])
  assert.deepEqual(instructorsOf({ instructor: '', secondaryInstructors: [] }), [])
  // Literal NULLs (case-insensitive) that reach a stored record are treated
  // as no instructor, so a stale "NULL" never shows in filters/views.
  assert.deepEqual(instructorsOf({ instructor: 'NULL', secondaryInstructors: ['null', 'Xu'] }), ['Xu'])
  assert.deepEqual(instructorsOf({ instructor: 'Xu', secondaryInstructors: ['NULL'] }), ['Xu'])
})

test('instructorChip shows one brief name plus a marker when others exist', () => {
  assert.deepEqual(instructorChip({ instructor: 'M. Vosmeier' }), { label: 'Vosmeier M', hasOthers: false })
  assert.deepEqual(instructorChip({ instructor: 'Wahl', secondaryInstructors: ['Xu'] }), {
    label: 'Wahl*',
    hasOthers: true,
  })
  assert.deepEqual(instructorChip({ instructor: '', secondaryInstructors: [] }), {
    label: '',
    hasOthers: false,
  })
})

test('buildIndex groups an offering under every instructor (lead and secondary)', () => {
  const index = buildIndex([
    {
      prefix: 'BIO',
      number: '161',
      section: 'A',
      instructor: 'Patterson',
      secondaryInstructors: ['Xu'],
      days: 'MWF',
      time: '8:00-9:10',
    },
  ])
  assert.ok(index.byInstructor.Patterson)
  assert.ok(index.byInstructor.Xu)
  assert.equal(index.byInstructor.Patterson[0], index.byInstructor.Xu[0])
  assert.deepEqual(index.byInstructor.Patterson[0].instructors, ['Patterson', 'Xu'])
  // No empty-string bucket for an offering without any instructor.
  assert.equal(index.byInstructor[''], undefined)
})

test('instructorConflicts flags double-bookings for secondary instructors too', () => {
  const index = buildIndex([
    {
      prefix: 'BIO',
      number: '161',
      section: 'A',
      instructor: 'Patterson',
      secondaryInstructors: ['Xu'],
      days: 'MWF',
      time: '8:00-9:10',
    },
    {
      prefix: 'CS',
      number: '120',
      section: 'A',
      instructor: 'Wahl',
      secondaryInstructors: ['Xu'],
      days: 'MWF',
      time: '9:20-10:30',
    },
  ])
  assert.deepEqual(instructorConflicts(index), [])
  const clash = buildIndex([
    {
      prefix: 'BIO',
      number: '161',
      section: 'A',
      instructor: 'Patterson',
      secondaryInstructors: ['Xu'],
      days: 'MWF',
      time: '8:00-9:10',
    },
    {
      prefix: 'CS',
      number: '120',
      section: 'A',
      instructor: 'Wahl',
      secondaryInstructors: ['Xu'],
      days: 'MWF',
      time: '8:00-9:10',
    },
  ])
  const conflicts = instructorConflicts(clash)
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].instructor, 'Xu')
  assert.equal(conflicts[0].a.o.section, 'A')
  assert.equal(conflicts[0].b.o.section, 'A')
})

test('instructor filter matches via a secondary instructor and colors by the selection', () => {
  const filter = buildFilter('instructor', [], ['Xu'])
  const item = { o: { instructor: 'Patterson' }, instructors: ['Patterson', 'Xu'] }
  assert.equal(filter.matches(item), true)
  assert.equal(filter.color(item), colorForInstructor('Xu'))
})

test('colorForSchedule returns a stable hex color per schedule', () => {
  assert.match(colorForSchedule('cs'), /^#[0-9a-f]{6}$/i)
  assert.equal(colorForSchedule('cs'), colorForSchedule('cs'))
})

test('split-meeting rows (same section, different bands) move/update/remove by id only', () => {
  // MUS 001 A meets on MW at one custom time AND on R at another: two rows
  // sharing the section tuple. Every edit targets the row whose id is given.
  const rows = [
    { prefix: 'MUS', number: '001', section: 'A', id: 'mus-mw', days: 'MW', time: '16:00-16:50' },
    { prefix: 'MUS', number: '001', section: 'A', id: 'mus-r', days: 'R', time: '16:10-17:00' },
  ]
  // Update: the R row changes, the MW sibling stays.
  const updated = updateOfferingInSchedule(
    rows,
    { prefix: 'MUS', number: '001', section: 'A', id: 'mus-r' },
    { instructor: 'Wahl' },
  )
  assert.equal(updated[0].instructor, undefined)
  assert.equal(updated[1].instructor, 'Wahl')
  // Move: dragging the MW row moves only it.
  const moved = moveOfferingSmart(
    rows,
    { prefix: 'MUS', number: '001', section: 'A', id: 'mus-mw' },
    { fromDay: 'M', toDay: 'T', group: 'TR', time: '10:00-11:45' },
    'F',
  )
  assert.equal(moved[0].days, 'TR')
  assert.equal(moved[1].days, 'R', 'sibling row untouched')
  // Remove: the R row alone; the tuple-only fallback still works for unique
  // sections (e.g. legacy rows never given an id).
  const removed = removeOfferingFromSchedule(rows, {
    prefix: 'MUS',
    number: '001',
    section: 'A',
    id: 'mus-r',
  })
  assert.deepEqual(
    removed.map((o) => o.id),
    ['mus-mw'],
  )
  assert.deepEqual(removeOfferingFromSchedule([rows[0]], { prefix: 'MUS', number: '001', section: 'A' }), [])
})

test('parseCsv assigns distinct ids to split-meeting and duplicate rows, deterministically', () => {
  const csv = [
    'dept_prefix,course_number,course_section,instructor,secondary_instr,days,times',
    'MUS,001,A,Smith,,MW,16:00-16:50',
    'MUS,001,A,Smith,,R,16:10-17:00',
    'MUS,001,A,Smith,,MW,16:00-16:50',
    'CS,101,A,Wahl,,MWF,9:20-10:30',
  ].join('\n')
  const rows = parseCsv(csv)
  assert.equal(new Set(rows.map((r) => r.id)).size, 4, 'split meetings and exact dupes each get a unique id')
  assert.notEqual(rows[0].id, rows[1].id, 'split-meeting rows differ')
  assert.notEqual(rows[0].id, rows[2].id, 'identical duplicate rows differ')
  // Deterministic: re-parsing the same file yields the same ids.
  assert.deepEqual(
    parseCsv(csv).map((r) => r.id),
    rows.map((r) => r.id),
  )
})

test('assignOfferingIds fills only missing ids and never rewrites existing ones', () => {
  const rows = [
    { prefix: 'MUS', number: '001', section: 'A', days: 'MW', time: '16:00-16:50' },
    { prefix: 'MUS', number: '001', section: 'A', id: 'keep-me', days: 'R', time: '16:10-17:00' },
  ]
  assignOfferingIds(rows)
  assert.equal(rows[1].id, 'keep-me')
  assert.ok(rows[0].id && rows[0].id !== 'keep-me')
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

test('isStandardPattern ignores band spelling — the comparison is by minutes', () => {
  // leading zeros, whitespace and seconds never change the band's meaning
  assert.equal(isStandardPattern('F', 'MWF', '08:00-09:10'), true)
  assert.equal(isStandardPattern('F', 'MWF', ' 8:00 - 9:10 '), true)
  assert.equal(isStandardPattern('F', 'TR', '08:00:00-09:45:00'), true)
  // reversed bands are invalid — always off-pattern
  assert.equal(isStandardPattern('F', 'MWF', '09:10-08:00'), false)
})

test('normalizeBand canonicalizes valid bands and passes invalid ones through', () => {
  assert.equal(normalizeBand('08:00-09:10'), '8:00-9:10')
  assert.equal(normalizeBand(' 8:00 - 9:10 '), '8:00-9:10')
  assert.equal(normalizeBand('08:00:00-09:10:00'), '8:00-9:10')
  // reversed/garbage bands stay visible (never silently blanked)
  assert.equal(normalizeBand('09:10-08:00'), '09:10-08:00')
  assert.equal(normalizeBand('garbage'), 'garbage')
  assert.equal(normalizeBand(''), '')
})

test('parseCsv regularizes any band spelling to the canonical form', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times',
      'CS,101,A,Vosmeier,MWF,08:00-09:10',
      'BIO,161,A,Patterson,TR," 10:00 - 11:45 "',
      'MAT,131,A,Aydogan,MWF,12:00:00-13:10:00',
    ].join('\n'),
  )
  assert.deepEqual(
    rows.map((r) => r.time),
    ['8:00-9:10', '10:00-11:45', '12:00-13:10'],
  )
  // exports come back canonical too
  assert.ok(renderCsv(rows).includes('CS,101,A,Vosmeier,,MWF,8:00-9:10'))
})

test('buildIndex buckets a band under one slot key regardless of spelling', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times',
      'CS,101,A,Vosmeier,MWF,8:00-9:10',
      'CS,201,B,Morgan,MWF,08:00-09:10',
    ].join('\n'),
  )
  const index = buildIndex(rows)
  const slotBuckets = Object.keys(index.bySlot).filter((k) => k.startsWith('M|8:00-9:10'))
  assert.deepEqual(slotBuckets, ['M|8:00-9:10'], 'one bucket, not two')
  assert.equal(index.bySlot[slotBuckets[0]].length, 2)
  // one grid block holds both
  const blocks = daySlotBlocks('M', index).filter((b) => b.time === '8:00-9:10')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].items.length, 2)
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
  assert.equal(inst.matches({ o: { instructor: 'Vosmeier' }, instructors: ['Vosmeier'] }), true)
  assert.equal(inst.matches({ o: { instructor: 'Morgan' }, instructors: ['Morgan'] }), false)
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

// ---------------------------------------------------------------------------
// Day timeline: lane assignment + expanded range
// ---------------------------------------------------------------------------

const min = (h, m = 0) => h * 60 + m

test('assignLanes: consecutive bands share one lane (no overlap on touch)', () => {
  const lanes = assignLanes([
    { time: '8:00-9:10', start: min(8), end: min(9, 10) },
    { time: '9:20-10:30', start: min(9, 20), end: min(10, 30) },
    { time: '10:40-11:50', start: min(10, 40), end: min(11, 50) },
  ])
  assert.equal(lanes.length, 3)
  for (const b of lanes) {
    assert.equal(b.lane, 0)
    assert.equal(b.laneCount, 1)
  }
})

test('assignLanes: strictly overlapping bands open lanes', () => {
  const lanes = assignLanes([
    { time: '8:00-9:10', start: min(8), end: min(9, 10) },
    { time: '8:30-9:00', start: min(8, 30), end: min(9) },
  ])
  assert.deepEqual(
    lanes.map((b) => b.lane),
    [0, 1],
  )
  assert.equal(lanes[0].laneCount, 2)
})

test('assignLanes: three-way pileup opens three lanes', () => {
  const lanes = assignLanes([
    { time: 'a', start: min(8), end: min(10) },
    { time: 'b', start: min(8, 30), end: min(9, 30) },
    { time: 'c', start: min(9), end: min(10) },
  ])
  assert.deepEqual(
    lanes.map((b) => b.lane),
    [0, 1, 2],
  )
  assert.equal(lanes[0].laneCount, 3)
})

test('assignLanes: freed lane is reused by a later, touching block', () => {
  const lanes = assignLanes([
    { time: 'a', start: min(8), end: min(9) },
    { time: 'b', start: min(8, 30), end: min(9, 30) },
    // starts exactly when lane 0's occupant ended -> back into lane 0, even
    // though it overlaps lane 1's occupant until 9:30
    { time: 'c', start: min(9), end: min(10) },
  ])
  assert.deepEqual(
    lanes.map((b) => b.lane),
    [0, 1, 0],
  )
  assert.equal(lanes[0].laneCount, 2)
})

test('assignLanes: longer span wins the first lane on a start tie', () => {
  const lanes = assignLanes([
    { time: 'short', start: min(8), end: min(9) },
    { time: 'long', start: min(8), end: min(10) },
  ])
  assert.equal(lanes[0].time, 'long')
  assert.equal(lanes[0].lane, 0)
  assert.equal(lanes[1].lane, 1)
})

test('dayTimelineRange: empty day / no meetings keeps the standard range', () => {
  assert.deepEqual(dayTimelineRange('F', buildIndex([]), 'M'), { start: min(8), end: min(16) })
  assert.deepEqual(dayTimelineRange('F', null, 'M'), { start: min(8), end: min(16) })
})

test('dayTimelineRange: expands (snapped) to the day earliest/latest meetings', () => {
  const index = buildIndex([
    { prefix: 'CS', number: '101', section: 'A', days: 'M', time: '7:15-8:00' },
    { prefix: 'MUS', number: '001', section: 'A', days: 'MWF', time: '15:00-18:05' },
  ])
  // 7:15 snaps to 7:00; 18:05 snaps to 18:30
  assert.deepEqual(dayTimelineRange('F', index, 'M'), { start: min(7), end: min(18, 30) })
  // other days keep the standard range
  assert.deepEqual(dayTimelineRange('F', index, 'T'), { start: min(8), end: min(16) })
})

test('dayTimelineRange: meetings inside the standard range keep it', () => {
  const index = buildIndex([{ prefix: 'CS', number: '101', section: 'A', days: 'M', time: '9:20-10:30' }])
  assert.deepEqual(dayTimelineRange('F', index, 'M'), { start: min(8), end: min(16) })
})

test('assignLanes: lanes scope to overlap clusters; non-overlapping bands stay full width', () => {
  const lanes = assignLanes([
    { time: 'wide', start: min(8), end: min(10, 30) },
    { time: 'a', start: min(8), end: min(9, 10) },
    { time: 'b', start: min(9, 20), end: min(10, 30) },
    { time: 'afternoon', start: min(10, 40), end: min(11, 50) },
  ])
  const wide = lanes.find((l) => l.time === 'wide')
  const a = lanes.find((l) => l.time === 'a')
  const b = lanes.find((l) => l.time === 'b')
  const afternoon = lanes.find((l) => l.time === 'afternoon')
  // The morning cluster splits into two lanes...
  assert.equal(wide.laneCount, 2)
  assert.equal(a.laneCount, 2)
  assert.equal(b.laneCount, 2)
  // ...while the afternoon block overlaps nothing and keeps full width.
  assert.equal(afternoon.lane, 0)
  assert.equal(afternoon.laneCount, 1)
})

test('assignLanes: without laneRank, the earliest (longer) block takes the left lane', () => {
  const lanes = assignLanes([
    { time: 'custom', start: min(8), end: min(10, 30) },
    { time: 'std', start: min(8), end: min(9, 10) },
  ])
  assert.equal(lanes.find((l) => l.time === 'custom').lane, 0)
  assert.equal(lanes.find((l) => l.time === 'std').lane, 1)
})

test('assignLanes: laneRank 1 pins off-pattern bands right, standard bands left', () => {
  const lanes = assignLanes([
    { time: 'custom', start: min(8), end: min(10, 30), laneRank: 1 },
    { time: 'std', start: min(8), end: min(9, 10), laneRank: 0 },
    { time: 'std2', start: min(9, 20), end: min(10, 30), laneRank: 0 },
  ])
  const custom = lanes.find((l) => l.time === 'custom')
  const std = lanes.find((l) => l.time === 'std')
  const std2 = lanes.find((l) => l.time === 'std2')
  // Standard bands share the left lane; the custom spans their right.
  assert.equal(std.lane, 0)
  assert.equal(std2.lane, 0)
  assert.equal(custom.lane, 1)
  assert.equal(std.laneCount, 2)
  assert.equal(custom.laneCount, 2)
})

test('assignLanes: later customs lane after existing ones, still right of standard', () => {
  const lanes = assignLanes([
    { time: 'std', start: min(9, 20), end: min(10, 30), laneRank: 0 },
    { time: 'c1', start: min(9), end: min(10), laneRank: 1 },
    { time: 'c2', start: min(9, 30), end: min(10, 30), laneRank: 1 },
  ])
  assert.equal(lanes.find((l) => l.time === 'std').lane, 0)
  assert.equal(lanes.find((l) => l.time === 'c1').lane, 1)
  assert.equal(lanes.find((l) => l.time === 'c2').lane, 2)
})
