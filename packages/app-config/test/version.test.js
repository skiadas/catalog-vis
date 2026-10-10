import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watchAppVersion } from '../version.js'

// A fetch fake that always resolves to the given JSON body. Using a real
// Response keeps the module's `typeof fetch` type satisfied.
const okJson = (data) => async () => new Response(JSON.stringify(data), { status: 200 })
const notOk = async () => new Response(null, { status: 404 })
const flush = () => new Promise((r) => setTimeout(r, 0))

test('fires onStale once when the server commit differs from the bundle', async () => {
  const calls = []
  const w = watchAppVersion({
    endpoint: 'api/version',
    current: 'aaaaaaa',
    intervalMs: 1e9,
    fetchImpl: okJson({ commit: 'bbbbbbb' }),
    documentImpl: null,
    onStale: (info) => calls.push(info),
  })
  try {
    await flush()
    assert.deepEqual(calls, [{ current: 'aaaaaaa', remote: 'bbbbbbb' }])
    // A later poll does not fire again — the prompt is one-shot.
    await w.check()
    assert.equal(calls.length, 1)
  } finally {
    w.stop()
  }
})

test('stays silent when the commits match', async () => {
  const calls = []
  const w = watchAppVersion({
    endpoint: 'api/version',
    current: 'aaaaaaa',
    intervalMs: 1e9,
    fetchImpl: okJson({ commit: 'aaaaaaa' }),
    documentImpl: null,
    onStale: () => calls.push('fired'),
  })
  try {
    await flush()
    assert.deepEqual(calls, [])
  } finally {
    w.stop()
  }
})

test('does nothing without a build id (dev / static hosting)', async () => {
  let fetched = 0
  const w = watchAppVersion({
    endpoint: 'api/version',
    current: '',
    intervalMs: 1e9,
    fetchImpl: async () => {
      fetched += 1
      return new Response(JSON.stringify({ commit: 'bbbbbbb' }), { status: 200 })
    },
    documentImpl: null,
    onStale: () => {},
  })
  await flush()
  assert.equal(fetched, 0)
  assert.equal(typeof w.stop, 'function')
  w.stop()
})

test('stays silent on a non-ok response, a missing commit, or a thrown fetch', async () => {
  const cases = [
    notOk,
    okJson({}),
    async () => {
      throw new Error('offline')
    },
  ]
  for (const fetchImpl of cases) {
    const calls = []
    const w = watchAppVersion({
      endpoint: 'api/version',
      current: 'aaaaaaa',
      intervalMs: 1e9,
      fetchImpl,
      documentImpl: null,
      onStale: () => calls.push('fired'),
    })
    await flush()
    assert.deepEqual(calls, [])
    w.stop()
  }
})

test('stop() ends the watch: a later check does not fire', async () => {
  let commit = 'aaaaaaa'
  const calls = []
  const w = watchAppVersion({
    endpoint: 'api/version',
    current: 'aaaaaaa',
    intervalMs: 1e9,
    fetchImpl: async () => new Response(JSON.stringify({ commit }), { status: 200 }),
    documentImpl: null,
    onStale: () => calls.push('fired'),
  })
  await flush()
  w.stop()
  commit = 'bbbbbbb' // the server moves on, but the watch is stopped
  await w.check()
  assert.deepEqual(calls, [])
})
