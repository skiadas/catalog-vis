import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectRestorable,
  readRestorable,
  readDrafts,
  writeDrafts,
} from '../src/draftPersistence.js'

const A = { prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '8:00-9:10' }
const B = { prefix: 'CS', number: '102', section: 'A', days: 'MWF', time: '9:20-10:30' }

test('collectRestorable keeps only dirty drafts, as unsent operations', () => {
  const payload = collectRestorable(
    {
      'base:F': { offerings: [A, B], baseline: [A], dirty: true },
      'base:W': { offerings: [A], baseline: [A], dirty: false },
    },
    { user: 7, appVersion: 'abc1234' },
  )
  assert.equal(payload.user, '7')
  assert.equal(payload.appVersion, 'abc1234')
  assert.equal(payload.drafts.length, 1)
  assert.equal(payload.drafts[0].scheduleId, 'base')
  assert.equal(payload.drafts[0].term, 'F')
  assert.deepEqual(payload.drafts[0].operations, [{ kind: 'add', offering: B }])
})

test('collectRestorable is null when nothing is unsent', () => {
  assert.equal(collectRestorable({}, {}), null)
  // A dirty draft with no net change carries nothing to restore.
  assert.equal(collectRestorable({ 'base:F': { offerings: [A], baseline: [A], dirty: true } }, {}), null)
})

test('readRestorable round-trips and filters by identity and schedule', () => {
  const raw = JSON.stringify({
    user: '7',
    appVersion: 'x',
    drafts: [{ scheduleId: '5', term: 'F', operations: [{ kind: 'add', offering: A }] }],
  })
  const resolve = (id) => (String(id) === '5' ? 5 : null)
  assert.deepEqual(readRestorable(raw, { user: '7', resolveScheduleId: resolve }), [
    { scheduleId: 5, term: 'F', operations: [{ kind: 'add', offering: A }] },
  ])
  // Another identity never restores this work.
  assert.deepEqual(readRestorable(raw, { user: '8', resolveScheduleId: resolve }), [])
  // A gone schedule drops its draft.
  assert.deepEqual(readRestorable(raw, { user: '7', resolveScheduleId: () => null }), [])
  // Malformed payloads are ignored, not thrown.
  assert.deepEqual(readRestorable('not json', { user: '7', resolveScheduleId: resolve }), [])
  assert.deepEqual(readRestorable(null, { user: '7', resolveScheduleId: resolve }), [])
})

test('writeDrafts/readDrafts persist and clear through a Storage-like object', () => {
  const map = new Map()
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
  writeDrafts(storage, { user: 'u', appVersion: '', drafts: [{ scheduleId: '1', term: 'F', operations: [] }] })
  assert.match(readDrafts(storage), /"user":"u"/)
  writeDrafts(storage, null)
  assert.equal(readDrafts(storage), null)
  // A missing storage is a silent no-op.
  assert.equal(readDrafts(null), null)
  assert.doesNotThrow(() => writeDrafts(null, { user: 'u' }))
})
