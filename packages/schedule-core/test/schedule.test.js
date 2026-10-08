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
  uniqueOfferingId,
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
  colorForCoreReq,
  buildFilter,
  buildVisual,
  buildEditVisual,
  proposeOverlay,
  instructorsInSchedule,
  departmentsInSchedule,
  coreReqsInSchedule,
  coreReqStats,
  moveOfferingSmart,
  rescheduleDays,
  updateOfferingInSchedule,
  DEFAULT_SLOT,
  nextSectionLetter,
  addOfferingToSchedule,
  removeOfferingFromSchedule,
  mergeOfferings,
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
  verticalScaleFactor,
  SCALE_CROWD_THRESHOLD,
  offeringCodeLabel,
  offeringSectionLabel,
  courseNumberLabel,
  offeringItemKey,
  DEFAULT_SEATS,
  CSV_COLUMNS,
  lastFirst,
} from '../schedule.js'

// The CSV header cells of a rendered file (the first line; headers never
// contain commas/quotes). Compared against `CSV_COLUMNS` so a new column needs
// no test edit here.
const headerOf = (csv) => csv.split('\n')[0].split(',')

// A complete offering record for `deepEqual`s, with every optional field at its
// canonical default. Adding a column means adding its default here once (and to
// the one canonical record-shape test) — not to every assertion.
const OFF = (fields = {}) => ({
  prefix: '',
  number: '',
  section: '',
  title: '',
  instructor: '',
  secondaryInstructors: [],
  days: '',
  time: '',
  seats: DEFAULT_SEATS,
  coreReqs: [],
  crossListed: [],
  ...fields,
})

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

test('nextSectionLetter starts at each term range (Fall A, Winter J, Spring S)', () => {
  assert.equal(nextSectionLetter([], 'MAT', '120', 'F'), 'A')
  assert.equal(nextSectionLetter([], 'MAT', '120', 'W'), 'J')
  assert.equal(nextSectionLetter([], 'MAT', '120', 'S'), 'S')
  // unknown term falls back to Fall's range
  assert.equal(nextSectionLetter([], 'MAT', '120', 'Z'), 'A')
})

test('nextSectionLetter skips used letters within the term range only', () => {
  const winter = [
    { prefix: 'MAT', number: '120', section: 'J' },
    { prefix: 'MAT', number: '120', section: 'K' },
  ]
  assert.equal(nextSectionLetter(winter, 'MAT', '120', 'W'), 'L')
  // letters below the range never consume a Winter slot
  const fallLetters = [
    { prefix: 'MAT', number: '120', section: 'A' },
    { prefix: 'MAT', number: '120', section: 'B' },
  ]
  assert.equal(nextSectionLetter(fallLetters, 'MAT', '120', 'W'), 'J')
})

test('nextSectionLetter doubles letters once the term range is exhausted', () => {
  const fallFull = 'ABCDEFGHI'.split('').map((section) => ({ prefix: 'MAT', number: '120', section }))
  assert.equal(nextSectionLetter(fallFull, 'MAT', '120', 'F'), 'AA')
  const fallDblA = [...fallFull, { prefix: 'MAT', number: '120', section: 'AA' }]
  assert.equal(nextSectionLetter(fallDblA, 'MAT', '120', 'F'), 'BB')
  // Winter doubles its own letters (J–R), not Fall's
  const winterFull = 'JKLMNOPQR'.split('').map((section) => ({ prefix: 'MAT', number: '120', section }))
  assert.equal(nextSectionLetter(winterFull, 'MAT', '120', 'W'), 'JJ')
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

test('mergeOfferings upserts by section tuple, keeping the target id', () => {
  const base = [
    {
      prefix: 'MUS',
      number: '101',
      section: 'A',
      id: 't1',
      instructor: 'Old',
      days: 'MWF',
      time: '9:20-10:30',
      seats: 20,
    },
    {
      prefix: 'MUS',
      number: '102',
      section: 'A',
      id: 't2',
      instructor: 'Keep',
      days: 'TR',
      time: '10:00-11:45',
    },
  ]
  const incoming = [
    {
      prefix: 'MUS',
      number: '101',
      section: 'A',
      instructor: 'New',
      days: 'MWF',
      time: '9:20-10:30',
      seats: 30,
      coreReqs: ['LA'],
    },
    { prefix: 'MUS', number: '103', section: 'B', instructor: 'Fresh', days: 'MWF', time: '8:00-9:10' },
  ]
  const out = mergeOfferings(base, incoming)
  assert.equal(out.added, 1)
  assert.equal(out.updated, 1)
  assert.equal(out.unchanged, 0)
  assert.deepEqual(out.outcomes, ['updated', 'added'], 'one outcome per incoming row, in order')
  assert.equal(out.offerings.length, 3)
  const updated = out.offerings.find((o) => o.number === '101')
  assert.equal(updated.id, 't1', 'the target row keeps its id')
  assert.equal(updated.instructor, 'New')
  assert.equal(updated.seats, 30)
  assert.deepEqual(updated.coreReqs, ['LA'])
  assert.deepEqual(
    out.offerings.find((o) => o.number === '102'),
    base[1],
    'untouched row preserved',
  )
  assert.equal(out.offerings.find((o) => o.number === '103').instructor, 'Fresh', 'new row appended')
})

test('mergeOfferings is a no-op for identical rows and matches split sections by band', () => {
  const base = [
    { prefix: 'MUS', number: '001', section: 'A', id: 'mw', days: 'MW', time: '16:00-16:50' },
    { prefix: 'MUS', number: '001', section: 'A', id: 'r', days: 'R', time: '16:10-17:00' },
  ]
  // Identical incoming -> unchanged, no rewrite.
  const same = mergeOfferings(
    base,
    base.map((o) => ({ ...o })),
  )
  assert.equal(same.added, 0)
  assert.equal(same.updated, 0)
  assert.equal(same.unchanged, 2)
  assert.deepEqual(same.outcomes, ['unchanged', 'unchanged'])
  // A changed R band updates only the R row; the MW sibling is untouched.
  const moved = mergeOfferings(base, [
    { prefix: 'MUS', number: '001', section: 'A', days: 'R', time: '14:15-16:00' },
  ])
  assert.equal(moved.updated, 1)
  assert.deepEqual(moved.outcomes, ['updated'])
  assert.equal(moved.offerings.find((o) => o.id === 'r').time, '14:15-16:00')
  assert.equal(moved.offerings.find((o) => o.id === 'mw').time, '16:00-16:50')
  // A band with no match is a new split meeting.
  const third = mergeOfferings(base, [
    { prefix: 'MUS', number: '001', section: 'A', days: 'T', time: '10:00-11:45' },
  ])
  assert.equal(third.added, 1)
  assert.deepEqual(third.outcomes, ['added'])
  assert.equal(third.offerings.length, 3)
})

test('mergeOfferings carries a source crossListOwner onto a new row', () => {
  const out = mergeOfferings(
    [],
    [{ prefix: 'ANTH', number: '222', section: 'A', days: 'MW', time: '9:00-10:10', crossListOwner: 'ANTH' }],
  )
  assert.equal(out.added, 1)
  assert.equal(out.offerings[0].crossListOwner, 'ANTH', 'the group owner travels with the copy')
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
  assert.deepEqual(
    rows[0],
    OFF({
      prefix: 'CS',
      number: '101',
      section: 'A',
      instructor: 'Vosmeier',
      days: 'MWF',
      time: '9:20-10:30',
      id: offeringIdFor({ prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30' }),
    }),
  )
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
  assert.deepEqual(
    rows[0],
    OFF({
      prefix: 'CS',
      number: '220',
      section: 'A',
      instructor: 'Wahl',
      days: '',
      time: '',
      id: offeringIdFor({ prefix: 'CS', number: '220', section: 'A', days: '', time: '' }),
    }),
  )
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

// The single canonical pin of the record shape and the column order. Adding a
// column means updating `OFF` (once) and these two expectations — no other CSV
// test should need to change.
test('the parsed record shape and rendered header are the canonical contract', () => {
  const [row] = parseCsv(
    'dept_prefix,course_number,course_section,title,instructor,secondary_instr,days,times,seats\nCS,101,A,,Vosmeier,,MWF,9:20-10:30,24\n',
  )
  assert.deepEqual(
    row,
    OFF({
      prefix: 'CS',
      number: '101',
      section: 'A',
      instructor: 'Vosmeier',
      days: 'MWF',
      time: '9:20-10:30',
      id: offeringIdFor({ prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30' }),
    }),
  )
  assert.deepEqual(headerOf(renderCsv([])), CSV_COLUMNS)
})

test('parseCsv tolerates a UTF-8 BOM, CRLF endings, and a quoted embedded newline', () => {
  const rows = parseCsv(
    '\uFEFFdept_prefix,course_number,course_section,title,instructor,days,times\r\n' +
      'CS,220,A,"Topics,\r\nsecond line",Wahl,MWF,9:20-10:30\r\n',
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].prefix, 'CS', 'the BOM is stripped from the first header cell')
  assert.equal(rows[0].title, 'Topics,\r\nsecond line', 'a quoted cell may contain a newline')
})

test('parseCsv tolerates ragged rows (missing and extra trailing cells)', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times',
      'CS,101,A,Vosmeier,MWF,9:20-10:30,EXTRA',
      'BIO,161,A,Patterson',
    ].join('\n'),
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0].prefix, 'CS')
  assert.equal(rows[1].prefix, 'BIO')
  assert.equal(rows[1].days, '')
  assert.equal(rows[1].time, '', 'missing cells read as blank')
})

test('parseCsv returns no rows for a malformed file instead of throwing', () => {
  assert.deepEqual(parseCsv('dept_prefix,course_number\nCS,"unterminated'), [])
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
  assert.deepEqual(headerOf(csv), [...CSV_COLUMNS, 'term'])
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
  assert.deepEqual(
    rows[0],
    OFF({
      prefix: 'BIO',
      number: '166',
      section: 'A',
      instructor: 'Patterson',
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
    }),
  )
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
    OFF({
      prefix: 'BIO',
      number: '166',
      section: 'A',
      instructor: 'Patterson',
      days: 'MWF',
      time: '9:20-10:30',
      id: offeringIdFor({ prefix: 'BIO', number: '166', section: 'A', days: 'MWF', time: '9:20-10:30' }),
    }),
    OFF({
      prefix: 'BIO',
      number: '166',
      section: 'A',
      instructor: 'Doe',
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
    }),
    OFF({
      prefix: 'BIO',
      number: '166',
      section: 'A',
      instructor: 'Doe',
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
    }),
  ])
})

test('parseCsv reads a seats column, defaulting blank/invalid cells to DEFAULT_SEATS', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times,seats',
      'CS,101,A,Vosmeier,MWF,9:20-10:30,30',
      'CS,101,B,Morgan,TR,10:00-11:45,',
      'CS,101,C,Doe,MWF,8:00-9:10,NULL',
      'CS,101,D,Doe,MWF,9:20-10:30,0',
      'CS,101,E,Doe,MWF,10:40-11:50,-5',
      'CS,101,F,Doe,MWF,12:00-13:10,abc',
    ].join('\n'),
  )
  assert.deepEqual(
    rows.map((r) => r.seats),
    [30, DEFAULT_SEATS, DEFAULT_SEATS, DEFAULT_SEATS, DEFAULT_SEATS, DEFAULT_SEATS],
  )
})

test('parseCsv defaults seats to DEFAULT_SEATS when the column is absent', () => {
  const [row] = parseCsv(
    'dept_prefix,course_number,course_section,instructor,days,times\nCS,101,A,Vosmeier,MWF,9:20-10:30\n',
  )
  assert.equal(row.seats, DEFAULT_SEATS)
})

test('renderCsv writes the seats column (blank when a row has none) and round-trips it', () => {
  const csv = renderCsv([
    {
      prefix: 'CS',
      number: '101',
      section: 'A',
      instructor: 'Vosmeier',
      days: 'MWF',
      time: '9:20-10:30',
      seats: 30,
    },
    { prefix: 'CS', number: '101', section: 'B', instructor: 'Morgan', days: 'TR', time: '10:00-11:45' },
  ])
  assert.deepEqual(headerOf(csv), CSV_COLUMNS)
  assert.equal(parseCsv(csv)[0].seats, 30)
  assert.equal(parseCsv(csv)[1].seats, DEFAULT_SEATS, 'a blank seats cell re-imports as the default')
  assert.deepEqual(
    parseCsv(csv).map((r) => r.seats),
    [30, DEFAULT_SEATS],
  )
})

test('parseCsv reads core_reqs as a comma list (blank/NULL = none) and dedupes', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times,core_reqs',
      'CS,220,A,Wahl,MWF,9:20-10:30,"SM, LA,SM"',
      'MAT,131,A,Aydogan,MWF,14:20-16:05,',
      'ENG,111,A,Doe,,,NULL',
    ].join('\n'),
  )
  assert.deepEqual(
    rows.map((r) => r.coreReqs),
    [['SM', 'LA'], [], []],
  )
})

test('core_reqs is always present on parsed records (default empty)', () => {
  const [row] = parseCsv(
    'dept_prefix,course_number,course_section,instructor,days,times\nCS,101,A,Vosmeier,MWF,9:20-10:30\n',
  )
  assert.deepEqual(row.coreReqs, [])
})

test('renderCsv writes the core_reqs column (blank when absent) and round-trips it', () => {
  const csv = renderCsv([
    {
      prefix: 'CS',
      number: '220',
      section: 'A',
      instructor: 'Wahl',
      days: 'MWF',
      time: '9:20-10:30',
      coreReqs: ['SM', 'LA'],
    },
    { prefix: 'MAT', number: '131', section: 'A', instructor: 'Aydogan', days: 'MWF', time: '14:20-16:05' },
  ])
  assert.equal(headerOf(csv).at(-2), 'core_reqs')
  assert.deepEqual(
    parseCsv(csv).map((r) => r.coreReqs),
    [['SM', 'LA'], []],
  )
  assert.deepEqual(parseCsv(csv), [
    OFF({
      prefix: 'CS',
      number: '220',
      section: 'A',
      instructor: 'Wahl',
      days: 'MWF',
      time: '9:20-10:30',
      coreReqs: ['SM', 'LA'],
      id: offeringIdFor({ prefix: 'CS', number: '220', section: 'A', days: 'MWF', time: '9:20-10:30' }),
    }),
    OFF({
      prefix: 'MAT',
      number: '131',
      section: 'A',
      instructor: 'Aydogan',
      days: 'MWF',
      time: '14:20-16:05',
      id: offeringIdFor({ prefix: 'MAT', number: '131', section: 'A', days: 'MWF', time: '14:20-16:05' }),
    }),
  ])
})

test('parseCsv reads cross_listed as a comma list (blank/NULL = none)', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times,cross_listed',
      'CS,263,A,Wahl,MWF,9:20-10:30,"ENGR, PHI"',
      'MAT,131,A,Aydogan,MWF,14:20-16:05,',
      'ENG,111,A,Doe,,,NULL',
    ].join('\n'),
  )
  assert.deepEqual(
    rows.map((r) => r.crossListed),
    [['ENGR', 'PHI'], [], []],
  )
})

test('cross_listed is always present on parsed records (default empty)', () => {
  const [row] = parseCsv(
    'dept_prefix,course_number,course_section,instructor,days,times\nCS,101,A,Vosmeier,MWF,9:20-10:30\n',
  )
  assert.deepEqual(row.crossListed, [])
})

test('renderCsv writes the cross_listed column (blank when absent) and round-trips it', () => {
  const csv = renderCsv([
    {
      prefix: 'CS',
      number: '263',
      section: 'A',
      instructor: 'Wahl',
      days: 'MWF',
      time: '9:20-10:30',
      crossListed: ['ENGR', 'PHI'],
    },
    { prefix: 'MAT', number: '131', section: 'A', instructor: 'Aydogan', days: 'MWF', time: '14:20-16:05' },
  ])
  assert.equal(headerOf(csv).at(-1), 'cross_listed')
  assert.deepEqual(
    parseCsv(csv).map((r) => r.crossListed),
    [['ENGR', 'PHI'], []],
  )
})

test('parseCsv reads a title column (blank/NULL = none)', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,title,instructor,days,times',
      'CS,220,A,Special Topics: Graphics,Wahl,MWF,9:20-10:30',
      'CS,101,A,,Vosmeier,MWF,8:00-9:10',
      'MAT,131,A,NULL,Aydogan,MWF,14:20-16:05',
    ].join('\n'),
  )
  assert.deepEqual(
    rows.map((r) => r.title),
    ['Special Topics: Graphics', '', ''],
  )
})

test('parseCsv mirrors a lecture title onto its labs (lab cell loses)', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,title,instructor,days,times',
      'BIO,166L,A1,Bogus Lab,Patterson,MWF,11:30-12:40',
      'BIO,166,A,Genetics,Patterson,TR,13:20-14:30',
    ].join('\n'),
  )
  const lecture = rows.find((r) => !r.lab)
  const lab = rows.find((r) => r.lab)
  assert.equal(lecture.title, 'Genetics')
  assert.equal(lab.title, 'Genetics', 'lab mirrors the lecture, whatever its own cell said')
})

test('parseCsv keeps an orphan lab title when no lecture row is present', () => {
  const [lab] = parseCsv(
    'dept_prefix,course_number,course_section,title,instructor,days,times\nBIO,166L,A1,Solo Lab,Patterson,MWF,11:30-12:40\n',
  )
  assert.equal(lab.lab, true)
  assert.equal(lab.title, 'Solo Lab')
})

test('renderCsv writes the title column (blank when a row has none) and round-trips it', () => {
  const csv = renderCsv([
    {
      prefix: 'CS',
      number: '220',
      section: 'A',
      title: 'Special Topics: Graphics',
      instructor: 'Wahl',
      days: 'MWF',
      time: '9:20-10:30',
    },
    { prefix: 'CS', number: '101', section: 'A', instructor: 'Vosmeier', days: 'MWF', time: '8:00-9:10' },
  ])
  assert.deepEqual(
    parseCsv(csv).map((r) => r.title),
    ['Special Topics: Graphics', ''],
  )
})

test('parseCsv accepts the registrar course_title alias (round-trip title wins)', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,course_title,instructor,days,times',
      'CS,220,A,Special Topics: Graphics,Wahl,MWF,9:20-10:30',
      'CS,101,A,,Vosmeier,MWF,8:00-9:10',
      'MAT,131,A,NULL,Aydogan,MWF,14:20-16:05',
    ].join('\n'),
  )
  assert.deepEqual(
    rows.map((r) => r.title),
    ['Special Topics: Graphics', '', ''],
  )
  const [both] = parseCsv(
    'dept_prefix,course_number,course_section,title,course_title,instructor,days,times\nCS,220,A,Round-trip name,Registrar name,Wahl,MWF,9:20-10:30\n',
  )
  assert.equal(both.title, 'Round-trip name', 'the round-trip column wins when both are present')
})

test('parseCsv reads the registrar course_limit as seats and ignores course_max', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times,course_limit,course_max',
      'CS,101,A,Vosmeier,MWF,9:20-10:30,30,99',
      'CS,101,B,Morgan,TR,10:00-11:45,,40',
      'CS,101,C,Doe,MWF,8:00-9:10,NULL,40',
    ].join('\n'),
  )
  assert.deepEqual(
    rows.map((r) => r.seats),
    [30, DEFAULT_SEATS, DEFAULT_SEATS],
    'course_limit is the seat count; course_max is ignored; blank/NULL falls to the default',
  )
  const [both] = parseCsv(
    'dept_prefix,course_number,course_section,instructor,days,times,seats,course_limit\nCS,101,A,Doe,MWF,9:20-10:30,12,30\n',
  )
  assert.equal(both.seats, 12, 'the round-trip seats column wins when both are present')
})

test('parseCsv reads registrar core_requirements as parenthesized area ids', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times,core_requirements',
      'CS,220,A,Wahl,MWF,9:20-10:30,"(LA) (SM)"',
      'MAT,131,A,Aydogan,MWF,14:20-16:05,(QL)(MW)',
      'ENG,111,A,Doe,,,',
      'HIS,101,A,Doe,,,NULL',
    ].join('\n'),
  )
  assert.deepEqual(
    rows.map((r) => r.coreReqs),
    [['LA', 'SM'], ['QL', 'MW'], [], []],
    'parentheses are separators, with or without spaces; blank/NULL is none',
  )
  const [both] = parseCsv(
    'dept_prefix,course_number,course_section,instructor,days,times,core_reqs,core_requirements\nCS,220,A,Wahl,MWF,9:20-10:30,"SM, LA","(HS)"\n',
  )
  assert.deepEqual(both.coreReqs, ['SM', 'LA'], 'the round-trip core_reqs column wins when both are present')
})

test('parseCsv derives cross_listed from the registrar parent column (present versions only)', () => {
  // CLA 251 A is the parent; CS 251 A and ENG 251 A name it. All three are
  // present, so each claims the other two prefixes. The parent cell is padded.
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times,cross_listed_parent_course',
      'CLA,251,A,Smith,MWF,9:20-10:30,NULL',
      'CS,251,A,Smith,MWF,9:20-10:30,CLA  251  A     ',
      'ENG,251,A,Smith,MWF,9:20-10:30,CLA 251 A',
    ].join('\n'),
  )
  const byCode = new Map(rows.map((r) => [`${r.prefix} ${r.number}`, r.crossListed]))
  assert.deepEqual(byCode.get('CLA 251'), ['CS', 'ENG'])
  assert.deepEqual(byCode.get('CS 251'), ['CLA', 'ENG'])
  assert.deepEqual(byCode.get('ENG 251'), ['CLA', 'CS'])
})

test('parseCsv connects two children of an absent parent but never claims the absent parent', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times,cross_listed_parent_course',
      'CS,251,A,Smith,MWF,9:20-10:30,CLA 251 A',
      'ENG,251,A,Smith,MWF,9:20-10:30,CLA 251 A',
    ].join('\n'),
  )
  assert.deepEqual(
    rows.map((r) => r.crossListed),
    [['ENG'], ['CS']],
  )
})

test('parseCsv falls back to the row section when the parent cell omits one', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times,cross_listed_parent_course',
      'CLA,251,A,Smith,MWF,9:20-10:30,NULL',
      'CS,251,A,Smith,MWF,9:20-10:30,CLA 251',
    ].join('\n'),
  )
  assert.deepEqual(
    rows.map((r) => r.crossListed),
    [['CS'], ['CLA']],
  )
})

test('parseCsv lets an explicit cross_listed cell win over the parent notation', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times,cross_listed,cross_listed_parent_course',
      'CLA,251,A,Smith,MWF,9:20-10:30,,NULL',
      'CS,251,A,Smith,MWF,9:20-10:30,ENGR,CLA 251 A',
      'PHI,251,A,Smith,MWF,9:20-10:30,,"NULL"',
    ].join('\n'),
  )
  assert.deepEqual(
    rows.map((r) => r.crossListed),
    [['CS'], ['ENGR'], []],
    'CLA (the referenced parent) claims CS; CS keeps its explicit cell; PHI is unclaimed',
  )
})

test('parseCsv ignores lab rows when deriving cross_listed from parent references', () => {
  const rows = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor,days,times,cross_listed_parent_course',
      'CLA,251,A,Smith,MWF,9:20-10:30,NULL',
      'CS,251,A,Smith,MWF,9:20-10:30,CLA 251 A',
      'CS,251L,A1,Smith,R,14:00-16:00,CLA 251 A',
    ].join('\n'),
  )
  const lab = rows.find((r) => r.lab)
  assert.deepEqual(lab.crossListed, [], 'labs are never cross-listed')
  const lecture = rows.find((r) => !r.lab && r.prefix === 'CS')
  assert.deepEqual(lecture.crossListed, ['CLA'])
})

test('lastFirst flips a "First Last" name and leaves comma/single-token names alone', () => {
  assert.equal(lastFirst('John Wahl'), 'Wahl, John')
  assert.equal(lastFirst('Charilaos Skiadas'), 'Skiadas, Charilaos')
  assert.equal(lastFirst('Mary Jane Smith'), 'Smith, Mary Jane')
  assert.equal(lastFirst('Wahl, John'), 'Wahl, John', 'an already-comma name passes through')
  assert.equal(lastFirst('Skiadas'), 'Skiadas', 'a single token has no surname to move')
  assert.equal(lastFirst(''), '')
})

test('renderCsv resolves the name columns to "Last, First" and keeps usernames last', () => {
  const fullName = (u) => ({ wahl: 'John Wahl', xu: 'Ray Xu' })[u] || null
  const csv = renderCsv(
    [
      {
        prefix: 'CS',
        number: '220',
        section: 'A',
        instructor: 'wahl',
        secondaryInstructors: ['xu'],
        days: 'MWF',
        time: '9:20-10:30',
        term: 'F',
      },
    ],
    { fullName },
  )
  const header = headerOf(csv)
  assert.deepEqual(header, [...CSV_COLUMNS, 'term'])
  // The full-name block leads (up by the identity columns); the username block
  // trails, right before the term.
  assert.ok(header.indexOf('instructor_name') < header.indexOf('days'), 'the name block leads')
  assert.ok(header.indexOf('instructor') > header.indexOf('seats'), 'the username block trails')
  assert.ok(header.indexOf('instructor') < header.indexOf('term'), 'usernames come before the term')
  assert.ok(csv.includes('"Wahl, John"'), 'the lead name is "Last, First"')
  assert.ok(csv.includes('"Xu, Ray"'), 'the secondary name is "Last, First"')
  // The username columns still carry the canonical ids and round-trip.
  const [row] = parseCsv(csv)
  assert.equal(row.instructor, 'wahl')
  assert.deepEqual(row.secondaryInstructors, ['xu'])
})

test('renderCsv falls back to the username when the directory resolves no name', () => {
  const offering = {
    prefix: 'CS',
    number: '220',
    section: 'A',
    instructor: 'wahl',
    days: 'MWF',
    time: '9:20-10:30',
  }
  assert.ok(renderCsv([offering]).includes(',wahl,'), 'no resolver at all (offline)')
  assert.ok(renderCsv([offering], { fullName: () => null }).includes(',wahl,'), 'person not in the directory')
})

test('parseCsv ignores the display-only name columns and tolerates a feed without usernames', () => {
  const namesOnly = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor_name,secondary_instr_name,days,times',
      'CS,220,A,"Wahl, John","Xu, Ray",MWF,9:20-10:30',
    ].join('\n'),
  )
  assert.equal(namesOnly[0].instructor, '', 'the name columns are display-only')
  assert.deepEqual(namesOnly[0].secondaryInstructors, [])

  const withUsernames = parseCsv(
    [
      'dept_prefix,course_number,course_section,instructor_name,secondary_instr_name,days,times,instructor,secondary_instr',
      'CS,220,A,"Wahl, John","Xu, Ray",MWF,9:20-10:30,wahl,"xu, ray"',
    ].join('\n'),
  )
  assert.equal(withUsernames[0].instructor, 'wahl', 'identity comes from the username columns')
  assert.deepEqual(withUsernames[0].secondaryInstructors, ['xu', 'ray'])
})

test('updateOfferingInSchedule mirrors a lecture title change onto its labs', () => {
  const before = [
    { prefix: 'BIO', number: '166', section: 'A', title: 'Genetics', instructor: 'Patterson' },
    { prefix: 'BIO', number: '166', section: 'A', title: 'Genetics', lab: true, labSeq: 1 },
    { prefix: 'BIO', number: '166', section: 'A', title: 'Genetics', lab: true, labSeq: 2 },
    { prefix: 'BIO', number: '165', section: 'A', title: 'Cell', lab: true, labSeq: 1 },
  ]
  const next = updateOfferingInSchedule(
    before,
    { prefix: 'BIO', number: '166', section: 'A' },
    { title: 'Genetics II' },
  )
  assert.equal(next[0].title, 'Genetics II', 'the lecture takes the new title')
  assert.deepEqual(
    next.slice(1, 3).map((o) => o.title),
    ['Genetics II', 'Genetics II'],
    "the lecture's labs follow",
  )
  assert.equal(next[3].title, 'Cell', "another lecture's lab is untouched")
})

test('updateOfferingInSchedule mirrors a cleared lecture title (and pairs it with a section rename)', () => {
  const before = [
    { prefix: 'BIO', number: '166', section: 'A', title: 'Genetics', instructor: 'Patterson' },
    { prefix: 'BIO', number: '166', section: 'A', title: 'Genetics', lab: true, labSeq: 1 },
  ]
  const cleared = updateOfferingInSchedule(
    before,
    { prefix: 'BIO', number: '166', section: 'A' },
    { title: '' },
  )
  assert.deepEqual(
    cleared.map((o) => o.title),
    ['', ''],
  )
  // A batch edit changing both title and section letter still re-titles the
  // labs (the title mirror runs before the letter rename).
  const resectioned = updateOfferingInSchedule(
    before,
    { prefix: 'BIO', number: '166', section: 'A' },
    { section: 'B', title: 'Genetics II' },
  )
  assert.equal(resectioned[0].section, 'B')
  assert.equal(resectioned[1].section, 'B', 'lab follows the lecture letter')
  assert.equal(resectioned[1].title, 'Genetics II', 'lab still took the title')
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

test('daySlotBlocks merges a course that coincides with a standard band of the day', () => {
  const index = buildIndex([
    { prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '10:40-11:50', instructor: 'Vosmeier' },
    // An MR weekday set at an exact MWF band: off-pattern as a pattern, but on
    // Monday it coincides with the MWF band, so it merges into the standard
    // block instead of rendering as a separate rail.
    { prefix: 'BIO', number: '161', section: 'A', days: 'MR', time: '10:40-11:50', instructor: 'Patterson' },
    // A genuine spanning custom in the same column (M) at another band.
    { prefix: 'MAT', number: '131', section: 'A', days: 'MWF', time: '8:00-10:30', instructor: 'Aydogan' },
  ])
  const blocks = daySlotBlocks('M', index, 'F')
  const atBand = blocks.filter((b) => b.time === '10:40-11:50')
  assert.equal(atBand.length, 1, 'coinciding course merges into the standard block')
  const merged = atBand[0]
  assert.equal(merged.offPattern, false)
  assert.deepEqual(
    merged.items.map((it) => it.o.prefix).sort(),
    ['BIO', 'CS'],
    'the block holds both courses',
  )
  // Spanning custom: its own off-pattern block, never merged with the band.
  const spanning = blocks.find((b) => b.time === '8:00-10:30')
  assert.equal(spanning.offPattern, true)
  // Sorted by start, longer spans first (contained rails paint on top).
  assert.equal(blocks[0].time, '8:00-10:30')
})

test('daySlotBlocks classifies per day: the same course is a rail on a day whose band it misses', () => {
  const index = buildIndex([
    // 10:40-11:50 is an MWF band but not a TR band, so BIO 161 merges on
    // Monday yet renders as an off-pattern rail on Thursday.
    { prefix: 'BIO', number: '161', section: 'A', days: 'MR', time: '10:40-11:50', instructor: 'Patterson' },
  ])
  const monday = daySlotBlocks('M', index, 'F')
  assert.equal(monday.length, 1)
  assert.equal(monday[0].offPattern, false, 'MWF-band time merges on Monday')
  const thursday = daySlotBlocks('R', index, 'F')
  assert.equal(thursday.length, 1)
  assert.equal(thursday[0].offPattern, true, 'the same time is a rail on Thursday')
})

test('blockStyle positions absolutely at the shared px-per-minute scale', () => {
  assert.deepEqual(blockStyle({ start: 560, end: 630 }), { top: '120px', height: '105px' })
})

test('offeringItemKey never collides between a lecture, its labs, or split rows', () => {
  const rows = [
    { prefix: 'CS', number: '223', section: 'J', days: '', time: '', instructor: 'Vosmeier', $sid: 'base' },
    {
      prefix: 'CS',
      number: '223',
      section: 'J',
      lab: true,
      labSeq: 1,
      days: '',
      time: '',
      instructor: 'Vosmeier',
      $sid: 'base',
    },
    {
      prefix: 'CS',
      number: '223',
      section: 'J',
      lab: true,
      labSeq: 2,
      days: '',
      time: '',
      instructor: 'Vosmeier',
      $sid: 'base',
    },
    // A split-meeting row of the lecture (distinct content id, same tuple).
    {
      prefix: 'CS',
      number: '223',
      section: 'J',
      days: 'R',
      time: '18:00-19:00',
      instructor: 'Vosmeier',
      $sid: 'base',
    },
  ]
  const index = buildIndex(assignOfferingIds(rows))
  const keys = index.byCourse['CS 223'].map((it) => offeringItemKey(it))
  assert.equal(new Set(keys).size, keys.length, 'lecture, labs, and split rows all distinct')
  // The same row in another schedule (different sid) is a distinct offering.
  const other = buildIndex(assignOfferingIds(rows.map((r) => ({ ...r, $sid: 'other' }))))
  assert.notEqual(
    offeringItemKey(other.byCourse['CS 223'][0]),
    offeringItemKey(index.byCourse['CS 223'][0]),
    'different source schedule stays distinct',
  )
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

test('uniqueOfferingId suffixes only on collision with an existing id', () => {
  const row = { prefix: 'BIO', number: '166', section: 'A', days: '', time: '' }
  // A free base id is returned verbatim.
  assert.equal(uniqueOfferingId([], row), offeringIdFor(row))
  // A split-meeting sibling already holding the blank-row id forces a suffix,
  // and a third blank row takes the next free suffix.
  const base = offeringIdFor(row)
  const first = { ...row, id: base }
  assert.equal(uniqueOfferingId([first], row), `${base}-2`)
  const second = { ...row, id: `${base}-2` }
  assert.equal(uniqueOfferingId([first, second], row), `${base}-3`)
  // Ids on rows that don't match the base never shift the result.
  assert.equal(uniqueOfferingId([{ ...row, id: 'other' }], row), base)
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
  assert.equal(parseCsv(renderCsv(rows))[0].time, '8:00-9:10')
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

test('buildFilter core mode matches a course by the areas it satisfies', () => {
  const reqsByCode = { 'CS 220': ['SM', 'QL'], 'BIO 166': ['SM'] }
  const reqsOf = (code) => reqsByCode[code] || []

  // Inactive until at least one area is selected.
  assert.equal(buildFilter('core', [], [], [], reqsOf).active, false)

  const filter = buildFilter('core', [], [], ['QL'], reqsOf)
  assert.equal(filter.active, true)
  assert.equal(filter.matches({ code: 'CS 220', o: { prefix: 'CS', number: '220' } }), true)
  assert.equal(filter.matches({ code: 'BIO 166', o: { prefix: 'BIO', number: '166' } }), false)
  assert.equal(
    filter.matches({ o: { prefix: 'MAT', number: '131' } }),
    false,
    'derives the code from the offering when the item carries no code',
  )
  assert.equal(
    filter.color({ code: 'CS 220', o: { prefix: 'CS', number: '220' } }),
    colorForCoreReq('QL'),
    'colors by the first selected area the course satisfies',
  )
})

test('buildVisual and buildEditVisual thread the core filter through', () => {
  const reqsOf = (code) => (code === 'CS 220' ? ['SM'] : [])
  const visual = buildVisual('core', [], [], ['s1'], true, ['SM'], reqsOf)
  assert.equal(visual.active, true, 'an active core filter wins over schedule coloring')
  assert.equal(visual.matches({ code: 'CS 220', o: { prefix: 'CS', number: '220' } }), true)
  assert.equal(visual.matches({ code: 'MAT 131', o: { prefix: 'MAT', number: '131' } }), false)

  const edit = buildEditVisual('core', [], [], () => '#x', ['SM'], reqsOf)
  assert.equal(edit.active, true)
  assert.equal(edit.matches({ code: 'CS 220', o: { prefix: 'CS', number: '220' } }), true)
  assert.equal(edit.matches({ code: 'MAT 131', o: { prefix: 'MAT', number: '131' } }), false)
})

test('coreReqsInSchedule lists the areas any course in the schedule satisfies', () => {
  const index = buildIndex([
    { prefix: 'CS', number: '220', section: 'A', days: 'MWF', time: '9:20-10:30' },
    { prefix: 'BIO', number: '166', section: 'A', days: 'TR', time: '10:00-11:45' },
  ])
  const reqs = [
    { id: 'SM', label: 'Science', courses: ['CS 220', 'MAT 131'] },
    { id: 'LA', label: 'Arts', courses: ['ARTD 126'] },
    { id: 'HS', label: 'History', courses: ['BIO 166'] },
  ]
  assert.deepEqual(
    coreReqsInSchedule(index, reqs).map((r) => r.id),
    ['SM', 'HS'],
  )
  assert.deepEqual(coreReqsInSchedule(index, undefined), [])
})

test('coreReqStats counts sections (labs excluded, split meetings merged) and seats per term', () => {
  const reqs = [
    { id: 'SM', label: 'Science', courses: ['CS 220', 'MAT 131'] },
    { id: 'LA', label: 'Arts', courses: ['ARTD 126'] },
  ]
  const stats = coreReqStats(
    {
      F: [
        { prefix: 'CS', number: '220', section: 'A', seats: 30 },
        { prefix: 'CS', number: '220', section: 'B', seats: 24 },
        // Split meeting: a second row for section A (same offering) must not
        // double-count, nor add seats twice.
        { prefix: 'CS', number: '220', section: 'A', seats: 30, days: 'R', time: '16:00-17:00' },
        { prefix: 'MAT', number: '131', section: 'A', seats: 20 },
        // A lab of a core course contributes nothing.
        { prefix: 'CS', number: '220', section: 'A', lab: true, labSeq: 1, seats: 12 },
        { prefix: 'BIO', number: '166', section: 'A', seats: 40 },
      ],
      W: [{ prefix: 'CS', number: '220', section: 'A', seats: 30 }],
      S: [],
    },
    reqs,
  )
  assert.deepEqual(stats, [
    {
      id: 'SM',
      label: 'Science',
      terms: {
        F: { offerings: 3, seats: 74 },
        W: { offerings: 1, seats: 30 },
        S: { offerings: 0, seats: 0 },
      },
      totals: { offerings: 4, seats: 104 },
    },
    {
      id: 'LA',
      label: 'Arts',
      terms: {
        F: { offerings: 0, seats: 0 },
        W: { offerings: 0, seats: 0 },
        S: { offerings: 0, seats: 0 },
      },
      totals: { offerings: 0, seats: 0 },
    },
  ])
})

test('coreReqStats counts unscheduled offerings too', () => {
  const [sm] = coreReqStats(
    { F: [{ prefix: 'CS', number: '220', section: 'A', days: '', time: '', seats: 30 }] },
    [{ id: 'SM', label: 'Science', courses: ['CS 220'] }],
  )
  assert.deepEqual(sm.terms.F, { offerings: 1, seats: 30 })
})

test('coreReqStats collapses cross-listed versions sharing one seat pool', () => {
  const reqs = [{ id: 'PP', label: 'Philosophical Perspectives', courses: ['CS 263', 'ENGR 263', 'PHI 263'] }]
  const groups = [{ id: 'cs-263-engr-263-phi-263', codes: ['CS 263', 'ENGR 263', 'PHI 263'] }]
  const [pp] = coreReqStats(
    {
      F: [
        { prefix: 'CS', number: '263', section: 'A', seats: 24 },
        { prefix: 'ENGR', number: '263', section: 'A', seats: 24 },
        // A split meeting on a group sibling still collapses to the one pool.
        { prefix: 'PHI', number: '263', section: 'A', seats: 24, days: 'R', time: '16:00-17:00' },
      ],
      W: [{ prefix: 'CS', number: '263', section: 'A', seats: 24 }],
      S: [],
    },
    reqs,
    groups,
  )
  assert.deepEqual(pp.terms.F, { offerings: 1, seats: 24 })
  assert.deepEqual(pp.terms.W, { offerings: 1, seats: 24 })
  assert.deepEqual(pp.totals, { offerings: 2, seats: 48 })
})

test('coreReqStats keeps distinct sections of a cross-listed group separate', () => {
  const groups = [['CS 263', 'ENGR 263']]
  const [pp] = coreReqStats(
    {
      F: [
        { prefix: 'CS', number: '263', section: 'A', seats: 24 },
        { prefix: 'ENGR', number: '263', section: 'A', seats: 24 },
        { prefix: 'CS', number: '263', section: 'B', seats: 30 },
        { prefix: 'ENGR', number: '263', section: 'B', seats: 30 },
      ],
      W: [],
      S: [],
    },
    [{ id: 'PP', label: 'Philosophical Perspectives', courses: ['CS 263', 'ENGR 263'] }],
    groups,
  )
  assert.deepEqual(pp.terms.F, { offerings: 2, seats: 54 })
})

test("coreReqStats: an offering's own coreReqs is authoritative over the catalog", () => {
  // The catalog lists BIO 161 under SM, but the imported row says QL, SL, SM —
  // the row's own areas decide (and a row claiming only QL would not count
  // toward SM even though the catalog lists it there).
  const reqs = [
    { id: 'SM', label: 'Science', courses: ['BIO 161'] },
    { id: 'QL', label: 'Quantitative Literacy', courses: [] },
    { id: 'SL', label: 'Lab', courses: [] },
  ]
  const [sm, ql, sl] = coreReqStats(
    {
      F: [
        { prefix: 'BIO', number: '161', section: 'A', seats: 24, coreReqs: ['QL', 'SL', 'SM'] },
        { prefix: 'BIO', number: '161', section: 'B', seats: 24, coreReqs: ['QL'] },
      ],
      W: [],
      S: [],
    },
    reqs,
  )
  assert.deepEqual(sm.terms.F, { offerings: 1, seats: 24 }, 'section B claims QL only')
  assert.deepEqual(ql.terms.F, { offerings: 2, seats: 48 })
  assert.deepEqual(sl.terms.F, { offerings: 1, seats: 24 })
})

test('coreReqStats: an untagged offering falls back to the catalog membership', () => {
  const reqs = [
    { id: 'SM', label: 'Science', courses: ['CS 220'] },
    { id: 'LA', label: 'Arts', courses: ['CS 220'] },
  ]
  const [sm, la] = coreReqStats(
    { F: [{ prefix: 'CS', number: '220', section: 'A', seats: 30 }], W: [], S: [] },
    reqs,
  )
  assert.deepEqual(sm.terms.F, { offerings: 1, seats: 30 })
  assert.deepEqual(la.terms.F, { offerings: 1, seats: 30 })
})

test('coreReqsInSchedule: the areasOf resolver overrides catalog membership', () => {
  const index = buildIndex([{ prefix: 'BIO', number: '161', section: 'A', days: 'MWF', time: '9:20-10:30' }])
  const reqs = [
    { id: 'SM', label: 'Science', courses: [] },
    { id: 'QL', label: 'Quantitative Literacy', courses: ['BIO 161'] },
  ]
  // The catalog lists BIO 161 under QL; the schedule's own data says SM.
  assert.deepEqual(
    coreReqsInSchedule(index, reqs).map((r) => r.id),
    ['QL'],
  )
  assert.deepEqual(
    coreReqsInSchedule(index, reqs, (code) => (code === 'BIO 161' ? ['SM'] : [])).map((r) => r.id),
    ['SM'],
  )
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

// ---------------------------------------------------------------------------
// Registrar-shaped labels: labs are identified by the L in the course number
// and the sequence in the section cell, never by a separate marker
// ---------------------------------------------------------------------------

test('offeringCodeLabel / offeringSectionLabel: registrar shapes', () => {
  const lecture = { prefix: 'BIO', number: '166', section: 'A' }
  assert.equal(offeringCodeLabel(lecture), 'BIO 166')
  assert.equal(offeringSectionLabel(lecture), 'A')
  const lab = { prefix: 'BIO', number: '166', section: 'A', lab: true, labSeq: 2 }
  assert.equal(offeringCodeLabel(lab), 'BIO 166L')
  assert.equal(offeringSectionLabel(lab), 'A2')
  assert.equal(courseNumberLabel(lab), '166L')
})

// ---------------------------------------------------------------------------
// Vertical calendar scale: the auto heuristic doubles a crowded view, and the
// explicit modes override it
// ---------------------------------------------------------------------------

test('verticalScaleFactor: auto scales only past the crowd threshold', () => {
  assert.equal(SCALE_CROWD_THRESHOLD, 3)
  assert.equal(verticalScaleFactor(0, 'auto'), 1)
  assert.equal(verticalScaleFactor(1, 'auto'), 1)
  assert.equal(verticalScaleFactor(3, 'auto'), 1)
  assert.equal(verticalScaleFactor(4, 'auto'), 2)
  assert.equal(verticalScaleFactor(9, 'auto'), 2)
  // Absent crowd defaults to the base scale.
  assert.equal(verticalScaleFactor(undefined, 'auto'), 1)
})

test('verticalScaleFactor: compact and tall are unconditional overrides', () => {
  assert.equal(verticalScaleFactor(0, 'compact'), 1)
  assert.equal(verticalScaleFactor(20, 'compact'), 1)
  assert.equal(verticalScaleFactor(0, 'tall'), 2)
  assert.equal(verticalScaleFactor(20, 'tall'), 2)
})
