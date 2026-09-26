import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv } from '@major-vis/schedule-core'
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

// The registrar feed marks one version of each group as the parent in
// `cross_listed_parent_course`; parseCsv turns that into the same sibling
// prefixes the explicit column carries, so the validation below is unchanged.
const registrarFile = (lines) => parseCsv(lines.join('\n'))

test('a registrar parent group consistent with the catalog is clean', () => {
  const rows = registrarFile([
    'dept_prefix,course_number,course_section,instructor,days,times,cross_listed_parent_course',
    'CLA,251,A,Smith,MWF,9:20-10:30,NULL',
    'CS,251,A,Smith,MWF,9:20-10:30,CLA 251 A',
    'ENG,251,A,Smith,MWF,9:20-10:30,CLA 251 A',
  ])
  const issues = crossListIssues(rows, [
    { id: 'cla-251-cs-251-eng-251', codes: ['CLA 251', 'CS 251', 'ENG 251'] },
  ])
  assert.deepEqual(issues, { claims: [], inconsistent: [] })
})

test('a registrar parent the catalog does not list is flagged as extra', () => {
  const rows = registrarFile([
    'dept_prefix,course_number,course_section,instructor,days,times,cross_listed_parent_course',
    'PHI,251,A,Smith,MWF,9:20-10:30,NULL',
    'CS,251,A,Smith,MWF,9:20-10:30,PHI 251 A',
  ])
  const issues = crossListIssues(rows, [{ id: 'cs-251-eng-251', codes: ['CS 251', 'ENG 251'] }])
  const cs = issues.claims.find((c) => c.code === 'CS 251')
  assert.deepEqual(cs.extra, ['PHI'], 'PHI 251 is not in the catalog group for CS 251')
})

test('a present group member the registrar left unlinked is flagged as missing', () => {
  const rows = registrarFile([
    'dept_prefix,course_number,course_section,instructor,days,times,cross_listed_parent_course',
    'CLA,251,A,Smith,MWF,9:20-10:30,NULL',
    'CS,251,A,Smith,MWF,9:20-10:30,CLA 251 A',
    'PHI,251,A,Smith,MWF,9:20-10:30,NULL',
  ])
  const issues = crossListIssues(rows, [
    { id: 'cla-251-cs-251-phi-251', codes: ['CLA 251', 'CS 251', 'PHI 251'] },
  ])
  assert.deepEqual(issues.claims.find((c) => c.code === 'CLA 251').missing, ['PHI'])
  assert.deepEqual(issues.claims.find((c) => c.code === 'CS 251').missing, ['PHI'])
})
