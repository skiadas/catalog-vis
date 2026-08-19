import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig, isEnabled, resetConfig, config, SERVICE_DEFS, SERVICE_KEYS } from '../index.js'

const fresh = () => {
  resetConfig()
  return globalThis.fetch
}

test('SERVICE_DEFS covers the three apps with stable keys and dirs', () => {
  assert.deepEqual(SERVICE_KEYS, ['program', 'schedule', 'planner'])
  const byKey = Object.fromEntries(SERVICE_DEFS.map((s) => [s.key, s]))
  assert.equal(byKey.program.dir, 'browse')
  assert.equal(byKey.schedule.dir, 'schedule')
  assert.equal(byKey.planner.dir, 'planner')
})

test('uses the server endpoint when it returns valid services', async () => {
  fresh()
  globalThis.fetch = async (url) =>
    url === 'api/config'
      ? { ok: true, json: async () => ({ services: ['schedule'], auth: { provider: 'username' } }) }
      : { ok: false }
  const cfg = await loadConfig({ endpoint: 'api/config', staticPath: 'config.json' })
  assert.deepEqual(cfg.services, ['schedule'])
  assert.deepEqual(cfg.auth, { provider: 'username' })
  assert.equal(isEnabled('schedule'), true)
  assert.equal(isEnabled('program'), false)
  assert.equal(isEnabled('planner'), false)
})

test('falls back to the static config.json when the endpoint 404s', async () => {
  fresh()
  globalThis.fetch = async (url) =>
    url === 'config.json'
      ? { ok: true, json: async () => ({ services: ['program', 'planner'] }) }
      : { ok: false }
  await loadConfig({ endpoint: 'api/config', staticPath: 'config.json' })
  assert.deepEqual(config().services, ['program', 'planner'])
  assert.equal(isEnabled('schedule'), false)
})

test('falls back to defaults when both sources are missing', async () => {
  fresh()
  globalThis.fetch = async () => ({ ok: false })
  await loadConfig({ endpoint: 'api/config', staticPath: 'config.json' })
  assert.deepEqual(config().services, ['program', 'schedule', 'planner'])
})

test('honors an explicit fallback list', async () => {
  fresh()
  globalThis.fetch = async () => ({ ok: false })
  await loadConfig({ fallback: ['schedule'] })
  assert.deepEqual(config().services, ['schedule'])
})

test('normalizes order/dedupe and drops unknown keys', async () => {
  fresh()
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ services: ['planner', 'bogus', 'schedule', 'program', 'schedule'] }),
  })
  await loadConfig({ endpoint: 'api/config' })
  assert.deepEqual(config().services, ['program', 'schedule', 'planner'])
})

test('treats a non-array or empty services list as an unusable source', async () => {
  fresh()
  let calls = 0
  globalThis.fetch = async (url) => {
    calls++
    return url === 'a'
      ? { ok: true, json: async () => ({ services: {} }) }
      : { ok: true, json: async () => ({ services: ['schedule'] }) }
  }
  await loadConfig({ endpoint: 'a', staticPath: 'b' })
  assert.equal(calls, 2)
  assert.deepEqual(config().services, ['schedule'])
})

test('guards against malformed endpoint payloads', async () => {
  fresh()
  globalThis.fetch = async () => ({ ok: true, json: async () => 'nope' })
  await loadConfig({ endpoint: 'api/config', staticPath: 'config.json', fallback: ['schedule'] })
  assert.deepEqual(config().services, ['schedule'])
})

test('concurrent callers share one load', async () => {
  fresh()
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    await new Promise((r) => setTimeout(r, 5))
    return { ok: true, json: async () => ({ services: ['schedule'] }) }
  }
  const [a, b] = await Promise.all([
    loadConfig({ endpoint: 'api/config' }),
    loadConfig({ endpoint: 'api/config' }),
  ])
  assert.equal(a, b)
  assert.equal(calls, 1)
})
