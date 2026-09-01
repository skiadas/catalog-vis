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

test('offeringKey prefers id and falls back to the identity tuple', () => {
  assert.equal(offeringKey({ id: 'x', prefix: 'CS', number: '220', section: 'A' }), 'id:x')
  assert.equal(offeringKey({ prefix: 'CS', number: '220', section: 'A' }), 'CS|220|A')
  // a lab and the lecture it mirrors are distinct identities
  assert.notEqual(
    offeringKey({ prefix: 'CS', number: '220', section: 'A', lab: true, labSeq: 1 }),
    offeringKey({ prefix: 'CS', number: '220', section: 'A' }),
  )
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
  assert.deepEqual(rem.cur, { prefix: 'CS', number: '101', section: 'A', lab: undefined, labSeq: undefined })
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
    describeChange({
      kind: 'update',
      cur: { prefix: 'CS', number: '101', section: 'A' },
      diff: [{ field: 'secondaryInstructors', from: ['Xu'], to: ['Xu', 'Ray'] }],
    }),
    'CS 101 A: other instructors from Xu to Xu, Ray',
  )
  assert.equal(
    describeChange({
      kind: 'update',
      cur: { prefix: 'CS', number: '101', section: 'A' },
      diff: [{ field: 'secondaryInstructors', from: [], to: ['Xu'] }],
    }),
    'CS 101 A: other instructors set to Xu',
  )
  assert.equal(
    describeChange({
      kind: 'update',
      cur: { prefix: 'CS', number: '101', section: 'A' },
      diff: [{ field: 'secondaryInstructors', from: ['Xu', 'Ray'], to: [] }],
    }),
    'CS 101 A: other instructors cleared',
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

test('diffOfferings diffs secondaryInstructors by list (not by string) and applies it', () => {
  const before = [OFF(1, { instructor: 'Wahl', secondaryInstructors: ['Xu'] })]
  const after = [OFF(1, { instructor: 'Wahl', secondaryInstructors: ['Xu', 'Ray'] })]
  const ops = diffOfferings(before, after)
  assert.equal(ops.length, 1)
  assert.deepEqual(ops[0].changes, { secondaryInstructors: ['Xu', 'Ray'] })
  assert.deepEqual(ops[0].diff, [{ field: 'secondaryInstructors', from: ['Xu'], to: ['Xu', 'Ray'] }])
  const applied = applyOperations(before, ops)
  assert.deepEqual(applied[0].secondaryInstructors, ['Xu', 'Ray'])
})

test('diffOfferings leaves secondaryInstructors alone when unchanged in content', () => {
  const ops = diffOfferings(
    [OFF(1, { instructor: 'Wahl', secondaryInstructors: ['Xu', 'Ray'] })],
    [OFF(1, { instructor: 'Wahl', secondaryInstructors: ['Xu', 'Ray'] })],
  )
  assert.equal(ops.length, 0)
  // Comparison normalizes whitespace per name, element-wise.
  const sameList = diffOfferings(
    [OFF(1, { instructor: 'Wahl', secondaryInstructors: ['Xu', 'Ray'] })],
    [OFF(1, { instructor: 'Wahl', secondaryInstructors: [' Xu ', 'Ray'] })],
  )
  assert.equal(sameList.length, 0)
})

test('split-meeting rows diff cleanly and apply to the exact row', () => {
  // MUS 001 A meets MW 16:00-16:50 and R 16:10-17:00: two rows sharing the
  // section tuple. Before content ids, every diff invented "days from R to MW"
  // updates for these — the phantom entries seen in history.
  const rows = [
    { prefix: 'MUS', number: '001', section: 'A', id: 'mus-mw', days: 'MW', time: '16:00-16:50' },
    { prefix: 'MUS', number: '001', section: 'A', id: 'mus-r', days: 'R', time: '16:10-17:00' },
  ]
  assert.equal(
    diffOfferings(
      rows,
      rows.map((r) => ({ ...r })),
    ).length,
    0,
    'unchanged state diffs empty',
  )

  const moved = [rows[0], { ...rows[1], days: 'T', time: '14:15-16:00' }]
  const ops = diffOfferings(rows, moved)
  assert.equal(ops.length, 1, 'moving one meeting is exactly one op')
  assert.equal(ops[0].kind, 'update')
  assert.equal(ops[0].cur.id, 'mus-r', 'the op targets the moved row by id')
  assert.match(describeChange(ops[0]), /^MUS 001 A: days from R to T/)

  const applied = applyOperations(rows, ops)
  assert.equal(applied[0].days, 'MW', 'sibling row untouched by apply')
  assert.equal(applied[1].days, 'T')
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

// ---------------------------------------------------------------------------
// Lab sections in diffs
// ---------------------------------------------------------------------------

const BIO_LAB = (extra = {}) => ({
  prefix: 'BIO',
  number: '166',
  section: 'A',
  instructor: 'Patterson',
  days: 'MWF',
  time: '9:20-10:30',
  ...extra,
})

test('diffOfferings targets a lab row (not the lecture it mirrors) for updates', () => {
  const before = [
    BIO_LAB(),
    BIO_LAB({ lab: true, labSeq: 1, instructor: 'Doe', days: 'TR', time: '10:00-11:45' }),
  ]
  const after = [
    BIO_LAB(),
    BIO_LAB({ lab: true, labSeq: 1, instructor: 'Eiriksson', days: 'TR', time: '10:00-11:45' }),
  ]
  const ops = diffOfferings(before, after)
  assert.equal(ops.length, 1)
  assert.equal(ops[0].kind, 'update')
  assert.equal(ops[0].cur.lab, true)
  assert.equal(ops[0].cur.labSeq, 1)
  assert.deepEqual(ops[0].changes, { instructor: 'Eiriksson' })
  // applying lands on the lab only
  const applied = applyOperations(before, ops)
  assert.equal(applied[1].instructor, 'Eiriksson')
  assert.equal(applied[0].instructor, 'Patterson')
})

test('diffOfferings produces separate ops for a lecture and its lab at the same section letter', () => {
  const before = [
    BIO_LAB({ lab: true, labSeq: 1, instructor: 'Doe', days: 'TR', time: '10:00-11:45' }),
    BIO_LAB(),
  ]
  const after = [
    BIO_LAB({ lab: true, labSeq: 1, instructor: 'Doe', days: 'TR', time: '14:15-16:00' }),
    BIO_LAB({ instructor: 'Morgan' }),
  ]
  const ops = diffOfferings(before, after).filter((o) => o.kind === 'update')
  assert.equal(ops.length, 2)
  const byLab = ops.filter((o) => o.cur.lab)
  const byLecture = ops.filter((o) => !o.cur.lab)
  assert.equal(byLab.length, 1)
  assert.equal(byLecture.length, 1)
  assert.deepEqual(byLab[0].changes, { time: '14:15-16:00' })
  assert.deepEqual(byLecture[0].changes, { instructor: 'Morgan' })
})

test('applyOperations removing a lecture cascades its labs away', () => {
  const list = [
    BIO_LAB(),
    BIO_LAB({ lab: true, labSeq: 1, instructor: 'Doe', days: 'TR', time: '10:00-11:45' }),
  ]
  const out = applyOperations(list, [{ kind: 'remove', cur: { prefix: 'BIO', number: '166', section: 'A' } }])
  assert.deepEqual(out, [])
})

test('applyOperations removes one lab without touching the lecture or sibling labs', () => {
  const list = [
    BIO_LAB(),
    BIO_LAB({ lab: true, labSeq: 1, instructor: 'Doe', days: 'TR', time: '10:00-11:45' }),
    BIO_LAB({ lab: true, labSeq: 2, instructor: 'Doe', days: 'W', time: '13:20-14:30' }),
  ]
  const out = applyOperations(list, [
    { kind: 'remove', cur: { prefix: 'BIO', number: '166', section: 'A', lab: true, labSeq: 1 } },
  ])
  assert.equal(out.length, 2)
  assert.equal(out.filter((o) => o.lab).length, 1)
  assert.equal(out.find((o) => o.lab).labSeq, 2)
})

test('describeChange prints lab numbers registrar-style', () => {
  assert.equal(
    describeChange({
      kind: 'update',
      cur: { prefix: 'BIO', number: '166', section: 'A', lab: true, labSeq: 2 },
      diff: [{ field: 'instructor', from: 'Doe', to: 'Eiriksson' }],
    }),
    'BIO 166L A2: instructor from Doe to Eiriksson',
  )
  assert.equal(
    describeChange({
      kind: 'add',
      offering: { prefix: 'BIO', number: '166', section: 'A', lab: true, labSeq: 1 },
    }),
    'add BIO 166L A1',
  )
})
