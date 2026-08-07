import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFacultyAndEligible, makeSchedule, mulberry32 } from '../lib/generate.js'

const PROGRAMS = [
  {
    course_prefix: 'CS',
    faculty: ['Skiadas', 'Morgan'],
    courses: [{ course_code: 'CS 101' }, { course_code: 'CS 210' }],
  },
  {
    course_prefix: 'BIO',
    faculty: ['Patterson', 'Vosmeier'],
    courses: [{ course_code: 'BIO 161' }, { course_code: 'BIO 250' }],
  },
  // Prefix-less program: contributes its faculty to the prefixes of its courses.
  {
    faculty: ['Liu'],
    courses: [{ course_code: 'MAT 120' }, { course_code: 'MAT 212' }],
  },
]

const ALL_COURSES = {
  'CS 101': {},
  'CS 210': {},
  'BIO 161': {},
  'BIO 250': {},
  'MAT 120': {},
  'MAT 212': {},
  ORPHAN: {},
}

test('buildFacultyAndEligible maps prefixes to faculty and lists eligible courses', () => {
  const { facultyByPrefix, eligible } = buildFacultyAndEligible(PROGRAMS, ALL_COURSES)
  // trailing period stripped
  assert.deepEqual(facultyByPrefix.CS, ['Morgan', 'Skiadas'])
  assert.deepEqual(facultyByPrefix.BIO, ['Patterson', 'Vosmeier'])
  // interdisciplinary program folded in by course prefix
  assert.deepEqual(facultyByPrefix.MAT, ['Liu'])
  // orphan code without a faculty prefix is not eligible
  assert.equal(
    eligible.some((c) => c.prefix === 'ORPHAN'),
    false,
  )
  assert.equal(eligible.length, 6)
})

test('makeSchedule random mode covers only eligible courses with valid slots', () => {
  const { facultyByPrefix, eligible } = buildFacultyAndEligible(PROGRAMS, ALL_COURSES)
  const offerings = makeSchedule('random', '', facultyByPrefix, eligible, 42)
  assert.ok(offerings.length > 0)
  for (const o of offerings) {
    assert.ok(['CS', 'BIO', 'MAT'].includes(o.prefix))
    assert.match(o.days, /^[MTWRF]+$/)
    assert.match(o.time, /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/)
    assert.ok(o.instructor)
    assert.match(o.section, /^[AB]$/)
  }
})

test('makeSchedule dept mode contains exclusively that department', () => {
  const { facultyByPrefix, eligible } = buildFacultyAndEligible(PROGRAMS, ALL_COURSES)
  const offerings = makeSchedule('dept', 'BIO', facultyByPrefix, eligible, 7)
  assert.ok(offerings.length > 0)
  for (const o of offerings) assert.equal(o.prefix, 'BIO')
})

test('makeSchedule dept mode with small pool stays deterministic', () => {
  const { facultyByPrefix, eligible } = buildFacultyAndEligible(PROGRAMS, ALL_COURSES)
  const a = makeSchedule('dept', 'CS', facultyByPrefix, eligible, 1)
  const b = makeSchedule('dept', 'CS', facultyByPrefix, eligible, 1)
  assert.deepEqual(a, b)
})

test('mulberry32 is deterministic', () => {
  const a = mulberry32(123)
  const b = mulberry32(123)
  for (let i = 0; i < 5; i++) assert.equal(a(), b())
})
