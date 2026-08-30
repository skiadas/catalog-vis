import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer, mountLocalBuiltApps, mountLocalLayout } from '../src/index.js'
import { startTestServer } from './helpers.mjs'
import express from 'express'

// A hermetic serving layout: a temp static root with the three catalog
// artifacts, the root launcher, and a built-looking app under apps/<name>/.
function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'major-vis-catalog-'))
  writeFileSync(
    join(dir, 'majors.json'),
    JSON.stringify({
      catalog_year: '2025-2026',
      generated_at: '2026-01-02T03:04:05.000Z',
      total_programs: 0,
      total_courses: 0,
      catalog: {},
      programs: [],
    }),
  )
  writeFileSync(
    join(dir, 'requirements_parsed.json'),
    JSON.stringify({ schema_version: '2.0', programs: [] }),
  )
  writeFileSync(join(dir, 'core_requirements.json'), JSON.stringify({ schema_version: '2.0', programs: [] }))
  writeFileSync(join(dir, 'index.html'), '<html><body>launcher</body></html>')
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ services: ['schedule'] }))
  mkdirSync(join(dir, 'apps', 'browse', 'assets'), { recursive: true })
  writeFileSync(join(dir, 'apps', 'browse', 'index.html'), '<html><body>browse</body></html>')
  writeFileSync(join(dir, 'apps', 'browse', 'assets', 'index-abc123.js'), 'console.log("built")')
  return dir
}

async function catalogServer(extraEnv = {}) {
  const dir = fixtureDir()
  const { app, database, config } = await buildServer({
    STATIC_DIR: dir,
    DB_PATH: join(dir, 'db.sqlite'),
    PORT: '0',
    ...extraEnv,
  })
  const srv = await startTestServer(app)
  return { srv, dir, db: database, config }
}

test('catalog artifacts are served with no-store and revalidation headers', async () => {
  const { srv, dir, db } = await catalogServer()
  try {
    for (const file of ['majors.json', 'requirements_parsed.json', 'core_requirements.json']) {
      const res = await srv.get(`/${file}`)
      assert.equal(res.status, 200, file)
      assert.equal(res.headers.get('content-type').startsWith('application/json'), true, file)
      assert.equal(res.headers.get('cache-control'), 'no-store', file)
      assert.ok(res.headers.get('etag'), file)
      if (file !== 'majors.json') assert.equal(res.json.schema_version, '2.0', file)
    }
  } finally {
    srv.close()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('catalog manifest summarizes the served artifacts', async () => {
  const { srv, dir, db } = await catalogServer()
  try {
    const res = await srv.get('/catalog.json')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(res.json, {
      catalog_year: '2025-2026',
      updated_at: '2026-01-02T03:04:05.000Z',
      schema_version: '2.0',
      artifacts: ['majors.json', 'requirements_parsed.json', 'core_requirements.json'],
    })
  } finally {
    srv.close()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('static layout: launcher, config.json, and built app assets are served; bundles are immutable-cached', async () => {
  const { srv, dir, db } = await catalogServer()
  try {
    const launcher = await srv.get('/')
    assert.equal(launcher.status, 200)
    assert.equal(launcher.text.includes('launcher'), true)
    const config = await srv.get('/config.json')
    assert.equal(config.status, 200)
    assert.equal(config.headers.get('cache-control'), 'no-store')
    const page = await srv.get('/apps/browse/')
    assert.equal(page.status, 200)
    assert.equal(page.text.includes('browse'), true)
    const asset = await srv.get('/apps/browse/assets/index-abc123.js')
    assert.equal(asset.status, 200)
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  } finally {
    srv.close()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('missing artifacts 404 with a clear error', async () => {
  const { srv, dir, db } = await catalogServer()
  try {
    rmSync(join(dir, 'core_requirements.json'))
    const res = await srv.get('/core_requirements.json')
    assert.equal(res.status, 404)
    assert.equal(res.json.error, 'not_found')
    const manifest = await srv.get('/catalog.json')
    assert.equal(manifest.status, 200)
  } finally {
    srv.close()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('local repo-root serving mounts the built apps at /apps/<name>/ (never the source dev index)', async () => {
  // A fake repo tree: source apps/<name>/index.html (dev-only) AND built
  // dist/<name>/ bundles, plus an app with no dist yet.
  const root = mkdtempSync(join(tmpdir(), 'major-vis-repo-'))
  mkdirSync(join(root, 'apps', 'schedule'), { recursive: true })
  mkdirSync(join(root, 'apps', 'browse'), { recursive: true })
  mkdirSync(join(root, 'dist', 'schedule', 'assets'), { recursive: true })
  writeFileSync(join(root, 'apps', 'schedule', 'index.html'), '<html><body>SOURCE DEV INDEX</body></html>')
  writeFileSync(join(root, 'apps', 'browse', 'index.html'), '<html><body>SOURCE DEV INDEX</body></html>')
  writeFileSync(join(root, 'dist', 'schedule', 'index.html'), '<html><body>BUILT BUNDLE</body></html>')
  writeFileSync(join(root, 'dist', 'schedule', 'assets', 'index-hash123.js'), 'export const ok = 1')

  const app = express()
  mountLocalBuiltApps(app, root)
  const srv = await startTestServer(app)
  try {
    // The built bundle wins over the source dev index.
    const page = await srv.get('/apps/schedule/')
    assert.equal(page.status, 200)
    assert.equal(page.text.includes('BUILT BUNDLE'), true)
    assert.equal(page.text.includes('SOURCE DEV INDEX'), false)
    // Hashed assets are served.
    const asset = await srv.get('/apps/schedule/assets/index-hash123.js')
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get('content-type'), /javascript/)
    // An app without a dist directory is not mounted.
    const missing = await srv.get('/apps/browse/')
    assert.equal(missing.status, 404)
  } finally {
    srv.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('the local-layout branch only mounts built apps when the static dir is the repo root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'major-vis-layout-'))
  mkdirSync(join(root, 'dist', 'schedule'), { recursive: true })
  writeFileSync(join(root, 'dist', 'schedule', 'index.html'), '<html><body>BUILT</body></html>')

  // staticDir === repoRoot: dist mounts; the source/dev index must not appear.
  const local = express()
  const srvLocal = await startTestServer(
    mountLocalLayout(local, { staticDir: root, repoRoot: root }),
  )
  try {
    const page = await srvLocal.get('/apps/schedule/')
    assert.equal(page.status, 200)
    assert.equal(page.text.includes('BUILT'), true)
  } finally {
    srvLocal.close()
  }

  // staticDir is an assembled layout elsewhere: nothing is mounted (the layout
  // itself owns the /apps/<name>/ slots).
  const assembled = express()
  const srvAssembled = await startTestServer(
    mountLocalLayout(assembled, { staticDir: '/srv/static', repoRoot: root }),
  )
  try {
    assert.equal((await srvAssembled.get('/apps/schedule/')).status, 404)
  } finally {
    srvAssembled.close()
    rmSync(root, { recursive: true, force: true })
  }
})
