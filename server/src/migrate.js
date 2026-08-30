// Ops CLI for the DB migrations (forward-only). Boot already applies pending
// migrations inside `openDb`; this script exists for ops visibility and manual
// control, e.g. `npm run migrate history` or `npm run migrate up`.
//
// Usage: node server/src/migrate.js <up|pending|history|down>
//   up       apply pending migrations (default)
//   pending  list unapplied migrations
//   history  list applied migrations
//   down     not supported — migrations are forward-only

import { loadConfig } from './config.js'
import { openDb, createMigrator, consoleLogger } from './db.js'

const action = process.argv[2] || 'up'
const config = loadConfig()
const db = await openDb(config.dbPath, { migrate: false })
const migrator = createMigrator(db, { logger: consoleLogger })

try {
  if (action === 'up') {
    await migrator.up()
  } else if (action === 'pending') {
    const pending = await migrator.pending()
    for (const m of pending) console.log(m.name)
  } else if (action === 'history') {
    const executed = await migrator.executed()
    for (const m of executed) console.log(m.name)
  } else {
    throw new Error(`unknown migrate action "${action}" — use up | pending | history`)
  }
} finally {
  db.close()
}
