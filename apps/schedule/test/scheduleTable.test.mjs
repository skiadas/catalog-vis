// The table view's pure helpers: department grouping and the inline-cell
// parsers. No DOM — just the small functions the table component leans on.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  compareTableRows,
  departmentOf,
  departmentsInOfferings,
  inDepartment,
  parseDaysInput,
  parseSeatsInput,
  parseTimeInput,
} from '../src/scheduleTable.js'

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

test('inDepartment matches case-insensitively; blank matches everything', () => {
  assert.equal(inDepartment(row({ prefix: 'CS' }), 'cs'), true)
  assert.equal(inDepartment(row({ prefix: 'CS' }), 'MAT'), false)
  assert.equal(inDepartment(row({ prefix: 'CS' }), ''), true)
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
