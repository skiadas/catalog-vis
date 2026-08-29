// Server entry point: reads config, opens the DB, builds the app, attaches
// static hosting for the apps + catalog artifacts, and listens. The API routes
// (createApp) are importable separately for tests.

import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import compression from 'compression'
import { loadConfig } from './config.js'
import { openDb } from './db.js'
import { createApp } from './app.js'
import { catalogRouter } from './catalog.js'

// In the container the assembled static layout (/srv/static) already holds the
// built apps under apps/<name>/. When serving the repo root directly (local
// `npm run serve`), those paths resolve to the source tree's dev-only
// index.html — so the built bundles are mounted at /apps/<name>/ instead,
// mirroring the container layout. Each mount is a no-op when dist is missing.
export function mountLocalBuiltApps(app, repoRoot) {
  for (const name of ['browse', 'schedule', 'planner']) {
    const distDir = path.join(repoRoot, 'dist', name)
    if (!existsSync(path.join(distDir, 'index.html'))) continue
    app.use(`/apps/${name}`, express.static(distDir))
  }
  return app
}

// The local-layout branch: only when the static dir IS the repo root do the
// built bundles take the /apps/<name>/ slots (an assembled container layout
// already holds built apps there). Tested as its own unit so the branch can't
// silently regress.
export function mountLocalLayout(app, config) {
  if (config.staticDir !== config.repoRoot) return app
  return mountLocalBuiltApps(app, config.repoRoot)
}

export function buildServer(env = process.env) {
  const config = loadConfig(env)
  const database = openDb(config.dbPath)
  const app = createApp({ database, services: config.services, sessionCookie: config.sessionCookie })

  // Compress everything — the catalog artifacts are the big transfers.
  app.use(compression())

  // Cache policy for the static layout: hashed bundles are immutable (their
  // filename changes when content does); catalog/config JSON must never be
  // stale (no-store). The catalog routes set their own headers; this covers
  // the files express.static serves (e.g. config.json).
  app.use((req, res, next) => {
    if (/^\/apps\/[^/]+\/assets\//.test(req.path)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    } else if (req.path.endsWith('.json')) {
      res.setHeader('Cache-Control', 'no-store')
    }
    next()
  })

  // Catalog API: the three artifacts + manifest, always public.
  app.use(catalogRouter(config.staticDir))

  // Local repo-root serving: the built apps take the /apps/<name>/ slots the
  // container assembles (runs before the generic static so the source tree's
  // dev index.html never wins).
  mountLocalLayout(app, config)

  // Static: the serving layout (`staticDir`) holds the root launcher
  // (index.html + config.json), the catalog artifacts, and the built apps
  // under apps/<name>/ (assembled from dist/ by the container). The apps'
  // relative seams — loadCatalog's `baseUrl: '../../'` and the schedule API
  // base `../../api` — resolve to this root, so serving the directory is
  // enough; the source tree apps/ is never served.
  app.use(express.static(config.staticDir))

  return { app, database, config }
}

// Only auto-start when run directly (so test imports don't bind a port).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const { app, config } = buildServer()
  app.listen(config.port, config.host, () => {
    console.log(`major-vis server listening on http://${config.host}:${config.port}`)
    console.log(`services: ${config.services.join(', ')}`)
  })
}
