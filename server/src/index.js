// Server entry point: reads config, opens the DB, builds the app, attaches
// static hosting for the apps + catalog artifacts, and listens. The API routes
// (createApp) are importable separately for tests.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { loadConfig } from './config.js'
import { openDb } from './db.js'
import { createApp } from './app.js'

export function buildServer(env = process.env) {
  const config = loadConfig(env)
  const database = openDb(config.dbPath)
  const app = createApp({ database, services: config.services, sessionCookie: config.sessionCookie })

  // Static: the repo root holds the three apps (`apps/<name>/`), the catalog
  // JSON, config.json, and the root launcher. The apps' import maps + baseUrl
  // resolve relative to their pages, so serving the root is enough.
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
