import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coreReqsDisagreements } from '../src/coreCompare.js'

const map = new Map([
  ['CS 220', ['SM', 'QL']],
  ['MAT 131', ['SM']],
])
const known = new Set(['CS 220', 'MAT 131', 'ARTD 126'])

test('agreeing rows produce no disagreements', () => {
  const { disagreements, unknown } = coreReqsDisagreements(
    [{ prefix: 'CS', number: '220', section: 'A', coreReqs: ['QL', 'SM'] }],
    map,
    known,
  )
  assert.deepEqual(disagreements, [])
  assert.equal(unknown, 0)
})

test('flags missing and extra areas in both directions', () => {
  const { disagreements } = coreReqsDisagreements(
    [
      { prefix: 'CS', number: '220', section: 'A', coreReqs: ['SM', 'LA'] },
      { prefix: 'MAT', number: '131', section: 'B', coreReqs: ['QL'] },
    ],
    map,
    known,
  )
  assert.deepEqual(disagreements, [
    {
      code: 'CS 220',
      section: 'A',
      file: ['SM', 'LA'],
      catalog: ['SM', 'QL'],
      missing: ['QL'],
      extra: ['LA'],
    },
    {
      code: 'MAT 131',
      section: 'B',
      file: ['QL'],
      catalog: ['SM'],
      missing: ['SM'],
      extra: ['QL'],
    },
  ])
})

test('blank cells and files without the column never flag', () => {
  const { disagreements, unknown } = coreReqsDisagreements(
    [
      { prefix: 'CS', number: '220', section: 'A', coreReqs: [] },
      { prefix: 'MAT', number: '131', section: 'A' },
    ],
    map,
    known,
  )
  assert.deepEqual(disagreements, [])
  assert.equal(unknown, 0)
})

test('courses the catalog does not carry are counted, not flagged', () => {
  const { disagreements, unknown } = coreReqsDisagreements(
    [{ prefix: 'ENG', number: '111', section: 'A', coreReqs: ['W1'] }],
    map,
    known,
  )
  assert.deepEqual(disagreements, [])
  assert.equal(unknown, 1)
})

test('a known catalog course with no core areas still flags a claimed area', () => {
  const { disagreements, unknown } = coreReqsDisagreements(
    [{ prefix: 'ARTD', number: '126', section: 'A', coreReqs: ['LA'] }],
    map,
    known,
  )
  assert.equal(unknown, 0)
  assert.deepEqual(disagreements, [
    { code: 'ARTD 126', section: 'A', file: ['LA'], catalog: [], missing: [], extra: ['LA'] },
  ])
})

test('a catalog area the file omits is flagged even when others match', () => {
  const { disagreements } = coreReqsDisagreements(
    [{ prefix: 'CS', number: '220', section: 'A', coreReqs: ['SM'] }],
    map,
    known,
  )
  assert.equal(disagreements.length, 1)
  assert.deepEqual(disagreements[0].missing, ['QL'])
  assert.deepEqual(disagreements[0].extra, [])
})

test('without knownCodes every code is treated as known', () => {
  const { disagreements, unknown } = coreReqsDisagreements(
    [{ prefix: 'XYZ', number: '999', section: 'A', coreReqs: ['LA'] }],
    map,
  )
  assert.equal(unknown, 0)
  assert.deepEqual(disagreements[0].extra, ['LA'])
})
