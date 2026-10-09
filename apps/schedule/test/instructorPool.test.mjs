import { test } from 'node:test'
import assert from 'node:assert/strict'

import { instructorPoolFor, defaultShowAll } from '../src/instructorPool.js'

const DEPT = [
  { value: 'jones', label: 'Jones' },
  { value: 'lee', label: 'Lee' },
]
const ALL = [
  { value: 'smith', label: 'Smith' },
  { value: 'jones', label: 'Jones' },
]

test('instructorPoolFor falls back to all instructors when the department pool is empty', () => {
  assert.deepEqual(instructorPoolFor({ deptOptions: [], allOptions: ALL, showAll: false }), ALL)
  assert.deepEqual(instructorPoolFor({ deptOptions: [], allOptions: ALL, showAll: true }), ALL)
  // Missing pools degrade to empty, never throw.
  assert.deepEqual(instructorPoolFor({}), [])
})

test('instructorPoolFor honors the scope flag when a department pool exists', () => {
  assert.deepEqual(instructorPoolFor({ deptOptions: DEPT, allOptions: ALL, showAll: false }), DEPT)
  assert.deepEqual(instructorPoolFor({ deptOptions: DEPT, allOptions: ALL, showAll: true }), ALL)
})

test('defaultShowAll opens the all-instructors pool for an outside instructor', () => {
  assert.equal(defaultShowAll('jones', DEPT), false, 'a department instructor stays on the dept pool')
  assert.equal(defaultShowAll('smith', DEPT), true, 'an outside instructor opens the all pool')
  assert.equal(defaultShowAll('', DEPT), false, 'a blank instructor defaults to the department')
  assert.equal(defaultShowAll('smith', []), true, 'with no department pool, all is the only option')
})
