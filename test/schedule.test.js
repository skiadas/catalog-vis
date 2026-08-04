import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WEEKDAYS,
  WEEKDAY_NAMES,
  SLOT_BLOCKS,
  toMinutes,
  formatTime,
  parseCsv,
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
  buildFilter,
  instructorsInSchedule,
  departmentsInSchedule,
} from '../lib/schedule.js'

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
