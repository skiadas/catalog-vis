// Local-dev directory seeding: at boot, load the repo-root `directory.csv`
// (the gitignored output of tools/catalog-pipeline/scrape_faculty.py) into the
// users table, so a developer sees real display names without signing in as an
// admin and bulk-importing by hand.
//
// This is the admin import's exact semantics — `parseDirectoryCsv` + the same
// upsert path (`POST /api/admin/users/import`) — run automatically once per
// boot, so the file stays authoritative for the rows it carries. Only wired up
// for the repo-root dev layout (see `config.seedDirectory`); a missing file is
// a silent no-op, and per-row problems are reported, never fatal.

import { existsSync, readFileSync } from 'node:fs'
import { parseDirectoryCsv } from './directory-import.js'
import { ensureUser, setUserDirectory, userByUsername } from './db.js'

/** @typedef {import('./db.js').DB} DB */

/**
 * Seed the user directory from a CSV file. Returns `{ seeded: false }` when the
 * file is absent; otherwise `{ seeded: true, added, updated, errors }`, where
 * `errors` are the non-fatal per-row problems (`{ row, reason }`) the parser
 * reports while the good rows still import.
 *
 * @param {DB} db
 * @param {{ csvPath: string, domain?: string }} options
 * @returns {{ seeded: boolean, added: number, updated: number, errors: Array<{ row: number, reason: string }> }}
 */
export function seedDirectoryFromCsv(db, { csvPath, domain = '' }) {
  if (!existsSync(csvPath)) return { seeded: false, added: 0, updated: 0, errors: [] }
  const { rows, errors } = parseDirectoryCsv(readFileSync(csvPath, 'utf8'), domain)
  let added = 0
  let updated = 0
  for (const row of rows) {
    const existed = Boolean(userByUsername(db, row.username))
    const user = ensureUser(db, row.username)
    setUserDirectory(db, user.id, { displayName: row.displayName, departments: row.departments })
    if (existed) updated += 1
    else added += 1
  }
  return { seeded: true, added, updated, errors }
}
