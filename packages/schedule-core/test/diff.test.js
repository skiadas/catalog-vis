import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  diffOfferings,
  applyOperations,
  describeChange,
  renderChanges,
  offeringKey,
  pureOps,
  suggestionStatus,
} from '../diff.js'

const OFF = (id, extra = {}) => ({
  prefix: 'CS',
  number: '220',
  section: 'A',
  instructor: 'Wahl',
  days: 'MWF',
  time: '9:20-10:30',
  ...extra,
})

test('offeringKey prefers id and falls back to prefix/number/section', () => {
  assert.equal(offeringKey({ id: 'x', prefix: 'CS', number: '220', section: 'A' }), 'id:x')
  assert.equal(offeringKey({ prefix: 'CS', number: '220', section: 'A' }), 'CS 220 A')
})

test('diffOfferings: add, update (with per-field diff), remove', () => {
  const before = [
    OFF(1, { number: '101' }),
    OFF(2, { number: '220', instructor: 'Wahl', days: 'MWF', time: '9:20-10:30' }),
  ]
  const after = [
    OFF(2, { number: '220', instructor: 'Skiadas', days: 'MWF', time: '9:20-10:30' }),
    OFF(3, { number: '330', section: 'A' }),
  ]
  const ops = diffOfferings(before, after)
  const kinds = ops.map((o) => o.kind)
  assert.deepEqual(kinds, ['update', 'add', 'remove'])
  // order-independent assertions
  const upd = ops.find((o) => o.kind === 'update')
  const add = ops.find((o) => o.kind === 'add')
  const rem = ops.find((o) => o.kind === 'remove')
  assert.deepEqual(upd.changes, { instructor: 'Skiadas' })
  assert.deepEqual(upd.diff, [{ field: 'instructor', from: 'Wahl', to: 'Skiadas' }])
  assert.deepEqual(add.offering.number, '330')
  assert.deepEqual(rem.cur, { prefix: 'CS', number: '101', section: 'A' })
})

test('diffOfferings returns empty when unchanged', () => {
  const list = [OFF(1, { number: '101' }), OFF(2, { number: '220' })]
  assert.deepEqual(
    diffOfferings(
      list,
      list.map((x) => ({ ...x })),
    ),
    [],
  )
})

test('diffOfferings ignores id-like whitespace trimming', () => {
  const a = [OFF(1, { number: '101', instructor: 'Wahl' })]
  const b = [OFF(1, { number: '101', instructor: '  Wahl  ' })]
  assert.deepEqual(diffOfferings(a, b), [])
})

test('applyOperations round-trips a diff', () => {
  const before = [OFF(1, { number: '101' }), OFF(2, { number: '220', instructor: 'Wahl' })]
  const after = [OFF(2, { number: '220', instructor: 'Skiadas' }), OFF(3, { number: '330' })]
  const ops = diffOfferings(before, after)
  const applied = applyOperations(before, ops)
  assert.equal(applied.length, 2)
  assert.ok(applied.some((o) => o.number === '220' && o.instructor === 'Skiadas'))
  assert.ok(applied.some((o) => o.number === '330'))
  assert.ok(!applied.some((o) => o.number === '101'))
})

test('applyOperations skips unknown/mismatched ops safely', () => {
  const list = [OFF(1, { number: '101' })]
  const out = applyOperations(list, [
    { kind: 'remove', cur: { prefix: 'CS', number: '999', section: 'A' } },
    { kind: 'nonsense' },
    { kind: 'update', cur: { prefix: 'CS', number: '101', section: 'A' }, changes: { instructor: 'X' } },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].instructor, 'X')
})

test('applyOperations dedupes duplicate adds so concurrent approvals stay clean', () => {
  const list = [OFF(1, { number: '101' })]
  const add = {
    kind: 'add',
    offering: { prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30' },
  }
  // Duplicate of an existing offering: skipped.
  assert.deepEqual(applyOperations(list, [add]), list)
  // Duplicate of an add in the same batch: only one lands.
  const fresh = applyOperations([], [add, { ...add }])
  assert.equal(fresh.length, 1)
  // A remove frees the identity: the same add can land again afterwards.
  const afterRemove = applyOperations(list, [
    { kind: 'remove', cur: { prefix: 'CS', number: '101', section: 'A' } },
    add,
  ])
  assert.equal(afterRemove.length, 1)
  assert.equal(afterRemove[0].time, '9:20-10:30')
})

test('pureOps unwraps entries and passes bare ops through', () => {
  const op = { kind: 'remove', cur: { prefix: 'CS', number: '101', section: 'A' } }
  const entry = { id: 3, op, resolution: { status: 'rejected' } }
  assert.deepEqual(pureOps([entry]), [op])
  assert.deepEqual(pureOps(null), [])
  assert.deepEqual(pureOps([op, entry]), [op, op])
  assert.deepEqual(pureOps([undefined, null]), [])
})

test('suggestionStatus derives the row status from entry resolutions', () => {
  const entry = (status, applied) => ({
    op: { kind: 'update', cur: { prefix: 'CS', number: '220', section: 'A' }, changes: { instructor: 'X' } },
    resolution: { status, ...(applied === undefined ? {} : { applied }) },
  })
  // Any pending op keeps the row live.
  assert.equal(suggestionStatus([entry('pending'), entry('accepted', true)]), null)
  // Empty proposals changed nothing and never will.
  assert.equal(suggestionStatus(undefined), 'moot')
  assert.equal(suggestionStatus([]), 'moot')
  // All rejected -> rejected.
  assert.equal(suggestionStatus([entry('rejected'), entry('rejected')]), 'rejected')
  // Accepted that changed the term -> approved, even with a rejected sibling.
  assert.equal(suggestionStatus([entry('accepted', true), entry('rejected')]), 'approved')
  // Accepted but nothing changed (already applied elsewhere) -> moot.
  assert.equal(suggestionStatus([entry('accepted', false), entry('rejected')]), 'moot')
  assert.equal(suggestionStatus([entry('accepted', false)]), 'moot')
  // Withdrawn outranks rejected; accepted still outranks both.
  assert.equal(suggestionStatus([entry('withdrawn'), entry('rejected')]), 'withdrawn')
  assert.equal(suggestionStatus([entry('withdrawn'), entry('accepted', true)]), 'approved')
  assert.equal(suggestionStatus([entry('withdrawn'), entry('accepted', false)]), 'moot')
})

test('describeChange reads naturally', () => {
  assert.equal(
    describeChange({
      kind: 'update',
      cur: { prefix: 'CS', number: '220', section: 'A' },
      diff: [{ field: 'instructor', from: 'Wahl', to: 'Skiadas' }],
    }),
    'CS 220 A: instructor from Wahl to Skiadas',
  )
  assert.equal(
    describeChange({ kind: 'add', offering: { prefix: 'BIO', number: '161', section: 'A' } }),
    'add BIO 161 A',
  )
  assert.equal(
    describeChange({ kind: 'remove', cur: { prefix: 'BIO', number: '161', section: 'A' } }),
    'remove BIO 161 A',
  )
  assert.equal(
    describeChange({
      kind: 'update',
      cur: { prefix: 'CS', number: '101', section: 'A' },
      diff: [{ field: 'time', from: '', to: '8:00-9:10' }],
    }),
    'CS 101 A: time set to 8:00-9:10',
  )
})

test('renderChanges formats as text, md, csv', () => {
  const ops = [
    {
      kind: 'update',
      cur: { prefix: 'CS', number: '220', section: 'A' },
      diff: [{ field: 'instructor', from: 'Wahl', to: 'Skiadas' }],
    },
  ]
  assert.equal(renderChanges(ops, 'text'), 'CS 220 A: instructor from Wahl to Skiadas')
  assert.equal(renderChanges(ops, 'md'), '- CS 220 A: instructor from Wahl to Skiadas')
  assert.equal(renderChanges(ops, 'csv'), 'change\nCS 220 A: instructor from Wahl to Skiadas')
})
