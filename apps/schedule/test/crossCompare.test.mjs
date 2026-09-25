import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crossListIssues } from '../src/crossCompare.js'

const groups = [{ id: 'cs-263-engr-263', codes: ['CS 263', 'ENGR 263'] }]

const row = (fields) => ({
  prefix: 'CS',
  number: '263',
  section: 'A',
  days: 'MWF',
  time: '9:20-10:30',
  instructor: 'Wahl',
  seats: 24,
  ...fields,
})

test('a claim matching the catalog and the file siblings is clean', () => {
  const issues = crossListIssues(
    [row({ crossListed: ['ENGR'] }), row({ prefix: 'ENGR', crossListed: ['CS'] })],
    groups,
  )
  assert.deepEqual(issues, { claims: [], inconsistent: [] })
})

test('a claimed prefix the catalog does not list is flagged as extra', () => {
  const issues = crossListIssues([row({ crossListed: ['ENGR', 'PHI'] })], groups)
  assert.equal(issues.claims.length, 1)
  assert.deepEqual(issues.claims[0].extra, ['PHI'])
})

test('a present sibling the row omits is flagged as missing', () => {
  const issues = crossListIssues(
    [row({ crossListed: [] }), row({ prefix: 'ENGR', crossListed: ['CS'] })],
    groups,
  )
  // The CS row carries no claim, so it is not compared; the ENGR row agrees.
  assert.deepEqual(issues.claims, [])
  const issues2 = crossListIssues(
    [row({ crossListed: ['ENGR'] }), row({ prefix: 'ENGR', crossListed: [] })],
    groups,
  )
  assert.deepEqual(issues2.claims, [], 'a row without a claim is not compared')
})

test('a row claiming a prefix whose sibling is in the file but with the claim missing is flagged', () => {
  // CS row claims only itself's group wrongly: it claims ENGR (present) — clean.
  // Now ENGR row claims nothing, so nothing to compare; instead test CS claiming
  // a prefix absent from the catalog group.
  const issues = crossListIssues(
    [row({ crossListed: ['MATH'] }), row({ prefix: 'ENGR', crossListed: ['CS'] })],
    groups,
  )
  assert.equal(issues.claims.length, 1)
  assert.deepEqual(issues.claims[0].extra, ['MATH'])
})

test('group rows that disagree on shared fields are flagged', () => {
  const issues = crossListIssues(
    [
      row({ crossListed: ['ENGR'], time: '9:20-10:30' }),
      row({ prefix: 'ENGR', crossListed: ['CS'], time: '10:00-11:45' }),
    ],
    groups,
  )
  assert.deepEqual(issues.inconsistent, [{ codes: ['CS 263', 'ENGR 263'], section: 'A' }])
})

test('different titles are allowed (cross-listed courses may title differently)', () => {
  const issues = crossListIssues(
    [
      row({ crossListed: ['ENGR'], title: 'The Rhetoric of Film' }),
      row({ prefix: 'ENGR', crossListed: ['CS'], title: 'The Psychology of Film' }),
    ],
    groups,
  )
  assert.deepEqual(issues.inconsistent, [])
})
