// The table view's pure helpers: department grouping and the inline-cell
// parsers. No DOM — just the small functions the table component leans on.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  compareTableRows,
  departmentOf,
  departmentsInOfferings,
  leadInstructorText,
  parseDaysInput,
  parseMeetingInput,
  parseSeatsInput,
  parseTimeInput,
  rowMatchesFilters,
  standardBandFor,
  standardBands,
} from '../src/scheduleTable.js'
import { buildInstructorOptions } from '../src/instructorSuggest.js'
import { buildNameIndex } from '../src/names.js'

const row = (fields) => ({ prefix: 'CS', number: '220', section: 'A', ...fields })

test('departmentOf uses the row prefix, uppercased', () => {
  assert.equal(departmentOf(row({ prefix: 'cs' })), 'CS')
  assert.equal(departmentOf({}), '')
})

test('departmentsInOfferings lists distinct prefixes, sorted', () => {
  const depts = departmentsInOfferings([
    row({ prefix: 'MAT' }),
    row({ prefix: 'CS' }),
    row({ prefix: 'CS' }),
    row({ prefix: 'BIO' }),
  ])
  assert.deepEqual(depts, ['BIO', 'CS', 'MAT'])
})

test('rowMatchesFilters combines department and instructor filters', () => {
  const cs = row({ prefix: 'CS', instructor: 'Jones', secondaryInstructors: ['Lee'] })
  const mat = row({ prefix: 'MAT', instructor: 'Smith' })
  // No filters: everything shows.
  assert.equal(rowMatchesFilters(cs, [], []), true)
  // Department only (case-insensitive, multi).
  assert.equal(rowMatchesFilters(cs, ['cs'], []), true)
  assert.equal(rowMatchesFilters(mat, ['CS'], []), false)
  assert.equal(rowMatchesFilters(mat, ['CS', 'MAT'], []), true)
  // Instructor only — matched against the full roster (lead or co-teacher).
  assert.equal(rowMatchesFilters(cs, [], ['Jones']), true)
  assert.equal(rowMatchesFilters(cs, [], ['Lee']), true)
  assert.equal(rowMatchesFilters(cs, [], ['Smith']), false)
  // Both must hold.
  assert.equal(rowMatchesFilters(cs, ['MAT'], ['Jones']), false)
  assert.equal(rowMatchesFilters(cs, ['CS'], ['Jones']), true)
})

test('compareTableRows orders by department, numeric number, section, then labs', () => {
  const list = [
    row({ prefix: 'CS', number: '220', section: 'B' }),
    row({ prefix: 'CS', number: '99', section: 'A' }),
    row({ prefix: 'BIO', number: '161', section: 'A' }),
    row({ prefix: 'CS', number: '220', section: 'A', lab: true, labSeq: 2 }),
    row({ prefix: 'CS', number: '220', section: 'A' }),
  ]
  const sorted = [...list].sort(compareTableRows)
  assert.deepEqual(
    sorted.map((o) => `${o.prefix} ${o.number}${o.lab ? 'L' : ''} ${o.section}${o.labSeq || ''}`),
    ['BIO 161 A', 'CS 99 A', 'CS 220 A', 'CS 220L A2', 'CS 220 B'],
  )
})

test('leadInstructorText shows the lead with a +N co-teacher count', () => {
  const nameOf = (v) => `[${v}]`
  assert.equal(leadInstructorText({ instructor: 'Smith', secondaryInstructors: [] }, nameOf), '[Smith]')
  assert.equal(
    leadInstructorText({ instructor: 'Smith', secondaryInstructors: ['Jones', 'Lee'] }, nameOf),
    '[Smith] +2',
  )
  assert.equal(leadInstructorText({ instructor: '', secondaryInstructors: ['Jones'] }, nameOf), '+1')
  assert.equal(leadInstructorText({ instructor: '', secondaryInstructors: [] }, nameOf), '')
  // A lead repeated among the co-teachers is deduped, so it isn't counted twice.
  assert.equal(
    leadInstructorText({ instructor: 'Smith', secondaryInstructors: ['Smith'] }, nameOf),
    '[Smith]',
  )
})

test('parseSeatsInput accepts positive integers only', () => {
  assert.equal(parseSeatsInput('30'), 30)
  assert.equal(parseSeatsInput(' 24 '), 24)
  assert.equal(parseSeatsInput('0'), null)
  assert.equal(parseSeatsInput('-5'), null)
  assert.equal(parseSeatsInput('2.5'), null)
  assert.equal(parseSeatsInput('many'), null)
  assert.equal(parseSeatsInput(''), null)
})

test('parseDaysInput canonicalizes weekday letters, blank, and rejects junk', () => {
  assert.equal(parseDaysInput('mwf'), 'MWF')
  assert.equal(parseDaysInput('TR'), 'TR')
  assert.equal(parseDaysInput('wmf'), 'MWF')
  assert.equal(parseDaysInput('MFW'), 'MWF')
  assert.equal(parseDaysInput(''), '')
  assert.equal(parseDaysInput('   '), '')
  assert.equal(parseDaysInput('MX'), null)
  assert.equal(parseDaysInput('MM'), null)
})

test('parseTimeInput normalizes valid bands and rejects junk', () => {
  assert.equal(parseTimeInput('8:00-9:10'), '8:00-9:10')
  assert.equal(parseTimeInput('08:00-09:10'), '8:00-9:10')
  assert.equal(parseTimeInput(' 13:00 - 14:30 '), '13:00-14:30')
  assert.equal(parseTimeInput(''), '')
  assert.equal(parseTimeInput('9:20'), null)
  assert.equal(parseTimeInput('10:00-9:00'), null)
  assert.equal(parseTimeInput('noon'), null)
})

test('standardBands enumerates the term bands (10 Fall/Winter, 7 Spring)', () => {
  const fall = standardBands('F')
  assert.equal(fall.length, 10)
  assert.deepEqual(fall[0], { days: 'MWF', time: '8:00-9:10' })
  assert.ok(fall.some((b) => b.days === 'TR' && b.time === '8:00-9:45'))

  const spring = standardBands('S')
  assert.equal(spring.length, 7)
  assert.ok(spring.some((b) => b.days === 'MTWRF' && b.time === '8:00-12:30'))
})

test('standardBandFor matches a normalized band and rejects custom days', () => {
  const bands = standardBands('F')
  assert.deepEqual(standardBandFor(bands, 'MWF', '08:00-09:10'), { days: 'MWF', time: '8:00-9:10' })
  assert.equal(standardBandFor(bands, 'MW', '8:00-9:10'), null)
  assert.equal(standardBandFor(bands, 'MWF', '8:11-9:10'), null)
  assert.equal(standardBandFor(bands, '', ''), null)
})

test('parseMeetingInput parses a day set plus band, rejecting junk', () => {
  assert.deepEqual(parseMeetingInput('MW 8:00-9:10'), { days: 'MW', time: '8:00-9:10' })
  assert.deepEqual(parseMeetingInput(' mwf 08:00-09:10 '), { days: 'MWF', time: '8:00-9:10' })
  assert.deepEqual(parseMeetingInput('TR 10:00 - 11:45'), { days: 'TR', time: '10:00-11:45' })
  assert.equal(parseMeetingInput('8:00-9:10'), null)
  assert.equal(parseMeetingInput('MW'), null)
  assert.equal(parseMeetingInput('MW 10:00-9:00'), null)
  assert.equal(parseMeetingInput('MX 8:00-9:10'), null)
  assert.equal(parseMeetingInput(''), null)
})

test('buildInstructorOptions scopes by department, dedupes, and offers all', () => {
  const directoryIndex = buildNameIndex([
    { username: 'jsmith', displayName: 'Jane Smith', departments: ['CS'] },
  ])
  const pools = buildInstructorOptions({
    prefix: 'CS',
    facultyByPrefix: { CS: ['Jones', 'Smith'], MAT: ['Lee'] },
    termOfferings: [
      { prefix: 'CS', instructor: 'Turing' },
      { prefix: 'MAT', instructor: 'Lee' },
    ],
    directoryIndex,
  })
  const deptLabels = pools.deptOptions.map((e) => e.label)
  assert.ok(deptLabels.includes('Jane Smith'))
  assert.ok(deptLabels.includes('Jones'))
  assert.ok(deptLabels.includes('Turing'))
  assert.ok(!deptLabels.includes('Lee'))
  // The catalog's bare "Smith" is dropped once the directory's person covers it.
  assert.ok(!pools.deptOptions.some((e) => e.value === 'Smith'))

  const allLabels = pools.allOptions.map((e) => e.label)
  assert.ok(allLabels.includes('Lee'))
  assert.ok(allLabels.includes('Jane Smith'))
  assert.ok(allLabels.includes('Jones'))
})
