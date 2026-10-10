import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../src/index.js'
import { startTestServer } from './helpers.mjs'

// Boots the full server against a scratch DB + static root, like the catalog
// tests, so /api/version is exercised through the real Express stack.
async function versionServer(extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'major-vis-version-'))
  const { app, database } = await buildServer({
    STATIC_DIR: dir,
    DB_PATH: join(dir, 'db.sqlite'),
    PORT: '0',
    NODE_ENV: 'test',
    ...extraEnv,
  })
  const srv = await startTestServer(app)
  return { srv, dir, db: database }
}

test('GET /api/version reports the injected build metadata as a short SHA', async () => {
  const { srv, dir, db } = await versionServer({
    GIT_SHA: '0123456789abcdef0123456789abcdef01234567',
    GIT_REF: 'main',
    GIT_BUILT_AT: '2026-10-10T12:00:00Z',
  })
  try {
    const res = await srv.get('/api/version')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(res.json, {
      commit: '0123456',
      ref: 'main',
      builtAt: '2026-10-10T12:00:00Z',
    })
  } finally {
    srv.close()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('GET /api/version is public and null without build metadata', async () => {
  const { srv, dir, db } = await versionServer()
  try {
    const res = await srv.get('/api/version')
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, { commit: null, ref: null, builtAt: null })
  } finally {
    srv.close()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
