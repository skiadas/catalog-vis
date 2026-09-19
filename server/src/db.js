// SQLite access layer via the built-in `node:sqlite` (Node >= 22.5). Owns the
// schema (versioned migrations applied by umzug at boot), and the repository
// functions for users, sessions, schedules, term parts, and suggested changes.
//
// The supertype distinction: schedule *records* (name/year/owner/status) with
// versioned *term parts* (payload = offerings). A suggested change targets one
// term part, records the base version + diff operations it was built against,
// and can be applied (owner) atomically with a version guard.

import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Umzug } from 'umzug'
import { suggestionStatus } from '@major-vis/schedule-core/diff'
import { assignOfferingIds } from '@major-vis/schedule-core'
import { canonicalUsername } from './names.js'

/** @typedef {import('node:sqlite').DatabaseSync} DB */

// Row shapes for the SELECTs below. Columns come from the migrations; the
// repository functions return typed rows so the rest of the server is typed
// against real names rather than raw `Record<string, any>`.
/**
 * @typedef {object} UserRow
 * @property {number} id
 * @property {string} username
 * @property {string | null} display_name
 * @property {string} departments
 */

/**
 * @typedef {object} DirectoryUserRow
 * @property {number} id
 * @property {string} username
 * @property {string | null} displayName
 * @property {string[]} departments
 */

/**
 * @typedef {object} SessionRow
 * @property {number} session_id
 * @property {string} expires_at
 * @property {number} user_id
 * @property {string} username
 */

/**
 * @typedef {object} ScheduleRow
 * @property {number} id
 * @property {string} name
 * @property {string} year
 * @property {string} status
 * @property {'private' | 'shared' | 'public'} visibility
 * @property {'owner' | 'shared' | 'public'} suggestMode
 * @property {string[]} viewers
 * @property {string[]} suggesters
 * @property {number} owner_user_id
 * @property {string | null} owner
 */

// The raw `schedules.*` row as SQLite returns it (JSON lists still strings,
// and `suggest_mode` in its snake_case column name) — what the repository
// SELECTs produce before `getSchedule`/`listSchedules` reshape them.
/**
 * @typedef {object} ScheduleRawRow
 * @property {number} id
 * @property {string} name
 * @property {string} year
 * @property {string} status
 * @property {'private' | 'shared' | 'public'} visibility
 * @property {'owner' | 'shared' | 'public'} suggest_mode
 * @property {string} viewers
 * @property {string} suggesters
 * @property {number} owner_user_id
 * @property {string | null} owner
 */

/**
 * @typedef {object} TermRow
 * @property {number} schedule_id
 * @property {'F' | 'W' | 'S'} term
 * @property {number} version
 * @property {string} payload
 */

/**
 * @typedef {object} SuggestionRow
 * @property {number} id
 * @property {number} schedule_id
 * @property {string} term
 * @property {number} proposer_user_id
 * @property {number} base_version
 * @property {string} note
 * @property {string | null} proposer
 * @property {string} status          — derived from the suggestion_ops rows
 * @property {string | null} resolved_at — max over the ops' resolved_at
 * @property {Array<{ id: number, op: object, resolution: { status: string, applied: boolean, resolved_at: string | null } }>} operations
 */

/**
 * @typedef {object} OidcFlowRow
 * @property {string} state
 * @property {string} nonce
 * @property {string} code_verifier
 * @property {string} return_to
 * @property {string} created_at
 * @property {string} expires_at
 */

/**
 * @typedef {object} SuggestionParentRow
 * @property {number} id
 * @property {number} schedule_id
 * @property {string} term
 * @property {number} proposer_user_id
 * @property {number} base_version
 * @property {string} note
 * @property {string} created_at
 * @property {string | null} proposer
 */

/**
 * @typedef {object} SuggestionOpRow
 * @property {number} id
 * @property {number} position
 * @property {string} op
 * @property {string} status
 * @property {number} applied
 * @property {string | null} resolved_at
 */

// ---- Migrations -----------------------------------------------------------

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const quietLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}

// umzug hands loggers record messages ({ event, name }) or strings.
function fmtLog(msg) {
  if (typeof msg === 'string') return msg
  return msg.name ? `${msg.event}: ${msg.name}` : msg.event
}

export const consoleLogger = {
  info: (msg) => console.log(fmtLog(msg)),
  warn: (msg) => console.warn(fmtLog(msg)),
  error: (msg) => console.error(fmtLog(msg)),
  debug: () => {},
}

// umzug storage: records each applied migration in a `schema_migrations` table
// in the same DB (the row is inserted after the migration function succeeds).
/**
 * @param {DB} db
 */
function sqliteStorage(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  )
  return {
    /** @param {{ name: string }} m */
    async logMigration({ name }) {
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name)
    },
    /** @param {{ name: string }} m */
    async unlogMigration({ name }) {
      db.prepare('DELETE FROM schema_migrations WHERE name = ?').run(name)
    },
    async executed() {
      const rows = /** @type {Array<{ name: string }>} */ (
        db.prepare('SELECT name FROM schema_migrations ORDER BY name').all()
      )
      return rows.map((r) => r.name)
    },
  }
}

// Loads .sql files from `dir` in filename order. Each file runs inside one
// transaction, so a failed migration leaves no partial DDL behind.
/**
 * @param {string} dir
 * @returns {import('umzug').RunnableMigration<DB>[]}
 */
function loadSqlMigrations(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      name: f.replace(/\.sql$/, ''),
      up: async (ctx) => transaction(ctx.context, (d) => d.exec(fs.readFileSync(path.join(dir, f), 'utf8'))),
      down: () => {
        throw new Error(`no down migration for ${f} — migrations are forward-only`)
      },
    }))
}

/**
 * @param {DB} db
 * @param {{ dir?: string; logger?: Record<'info' | 'warn' | 'error' | 'debug', (msg: Record<string, unknown>) => void> }} [opts]
 */
export function createMigrator(db, { dir = MIGRATIONS_DIR, logger = quietLogger } = {}) {
  return new Umzug({
    migrations: loadSqlMigrations(dir),
    context: db,
    storage: sqliteStorage(db),
    logger,
  })
}

/**
 * @param {DB} db
 * @param {{ dir?: string }} [opts]
 */
export async function runMigrations(db, { dir } = {}) {
  await createMigrator(db, { dir }).up()
}

// ---- Open / close ----------------------------------------------------------

/**
 * @param {string} dbPath
 * @param {{ migrate?: boolean }} [opts]
 * @returns {Promise<DB>}
 */
export async function openDb(dbPath, { migrate = true } = {}) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')
  if (migrate) await runMigrations(db)
  return db
}

// Wrap a sequence of statements in a transaction. `fn` receives the raw db.
/**
 * @param {DB} db
 */
export function transaction(db, fn) {
  db.exec('BEGIN;')
  try {
    const result = fn(db)
    db.exec('COMMIT;')
    return result
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

// ---- Auth ----------------------------------------------------------------

/**
 * @param {DB} db
 */
export function userByUsername(db, username) {
  const row = /** @type {UserRow | undefined} */ (
    db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  )
  return row || null
}

/**
 * @param {DB} db
 */
export function getUser(db, id) {
  const row = /** @type {UserRow | undefined} */ (db.prepare('SELECT * FROM users WHERE id = ?').get(id))
  return row || null
}

/**
 * @param {DB} db
 */
export function createUser(db, username) {
  const info = db.prepare('INSERT INTO users (username) VALUES (?)').run(username)
  return { id: Number(info.lastInsertRowid), username }
}

// Find-or-create the user; returns the user row.
/**
 * @param {DB} db
 */
export function ensureUser(db, username) {
  const found = userByUsername(db, username)
  if (found) return found
  return createUser(db, username)
}

// ---- User directory (admin-maintained) -----------------------------------
// Admins keep a directory over the JIT-provisioned accounts: a display name
// (the real/catalog name shown instead of the bare username) and the
// departments the user belongs to (course prefixes, used to scope whose
// suggestions may touch which departments). Accounts can be pre-created
// before the person ever signs in.

// Parses a stored JSON department list back into an array.
/**
 * @param {string} str
 * @returns {string[]}
 */
function storedPrefixList(str) {
  try {
    const arr = JSON.parse(String(str ?? '[]'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

// Canonicalizes + validates a department prefix list for storage: each entry
// trimmed + uppercased (course prefixes are case-insensitive), deduped,
// non-empty, length-bounded. Returns the list, or null when the input isn't a
// valid prefix list.
/**
 * @param {unknown} list
 * @returns {string[] | null}
 */
export function normalizePrefixList(list) {
  if (!Array.isArray(list)) return null
  const out = []
  const seen = new Set()
  for (const raw of list) {
    const prefix = String(raw ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
    if (!prefix || prefix.length > 12) return null
    if (!seen.has(prefix)) {
      seen.add(prefix)
      out.push(prefix)
    }
  }
  return out
}

// The full directory: every account with its display name and departments,
// sorted by username (the email local part, typically the surname), which reads
// better than sorting on the display name's first name.
/**
 * @param {DB} db
 * @returns {DirectoryUserRow[]}
 */
export function listUsers(db) {
  const rows = /** @type {UserRow[]} */ (db.prepare('SELECT * FROM users ORDER BY username').all())
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    departments: storedPrefixList(r.departments),
  }))
}

// Updates a directory entry's display name and/or departments. Departments are
// stored as the canonical (uppercased, deduped) list. Returns the updated
// entry, or null when the id is unknown.
/**
 * @param {DB} db
 * @param {number} id
 * @param {{ displayName?: string | null; departments?: string[] }} changes
 * @returns {DirectoryUserRow | null}
 */
export function setUserDirectory(db, id, { displayName, departments }) {
  const fields = []
  const vals = []
  if (displayName !== undefined) {
    fields.push('display_name = ?')
    vals.push(displayName === null ? null : displayName.slice(0, 120))
  }
  if (departments !== undefined) {
    fields.push('departments = ?')
    vals.push(JSON.stringify(departments))
  }
  if (!fields.length) return getDirectoryUser(db, id)
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...vals, id)
  return getDirectoryUser(db, id)
}

/**
 * @param {DB} db
 * @param {number} id
 * @returns {DirectoryUserRow | null}
 */
export function getDirectoryUser(db, id) {
  const row = /** @type {UserRow | undefined} */ (db.prepare('SELECT * FROM users WHERE id = ?').get(id))
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    departments: storedPrefixList(row.departments),
  }
}

/**
 * @param {DB} db
 */
export function createSession(db, userId, tokenHash, ttl = 86400 * 30) {
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()
  db.prepare('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(
    userId,
    tokenHash,
    expiresAt,
  )
}

/**
 * @param {DB} db
 */
export function sessionUser(db, tokenHash) {
  const row = /** @type {SessionRow | undefined} */ (
    db
      .prepare(
        `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.username
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
      )
      .get(tokenHash)
  )
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id)
    return null
  }
  return { id: row.user_id, username: row.username }
}

/**
 * @param {DB} db
 */
export function deleteSession(db, tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
}

// ---- OIDC login flows ------------------------------------------------------
// One row per in-flight authorization-code login: the state/nonce/PKCE checks
// the callback must satisfy, plus where to send the browser afterwards. The
// state is the primary key, so a replayed callback finds no row.

/**
 * @param {DB} db
 * @param {{ state: string, nonce: string, codeVerifier: string, returnTo?: string, ttl?: number }} flow
 */
export function createOidcFlow(db, { state, nonce, codeVerifier, returnTo = '/', ttl = 600 }) {
  // Lazy pruning: the login path is the only writer, so expired rows from
  // abandoned logins are swept here instead of on a timer.
  db.prepare('DELETE FROM oidc_flows WHERE expires_at < ?').run(new Date().toISOString())
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()
  db.prepare(
    `INSERT INTO oidc_flows (state, nonce, code_verifier, return_to, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(state, nonce, codeVerifier, returnTo, expiresAt)
}

// Deletes and returns the flow for `state` (single use). Returns null when the
// state is unknown or already expired.
/**
 * @param {DB} db
 * @returns {OidcFlowRow | null}
 */
export function consumeOidcFlow(db, state) {
  return transaction(db, (d) => {
    const row = /** @type {OidcFlowRow | undefined} */ (
      d.prepare('SELECT * FROM oidc_flows WHERE state = ?').get(state)
    )
    if (!row) return null
    d.prepare('DELETE FROM oidc_flows WHERE state = ?').run(state)
    if (new Date(row.expires_at).getTime() < Date.now()) return null
    return row
  })
}

// ---- Access control ------------------------------------------------------
// Per-schedule visibility + suggestion permissions, enforced by the routes.
// `viewers`/`suggesters` are canonical username lists on the schedule row;
// modes: visibility 'private' (owner only) | 'shared' (listed viewers) |
// 'public' (everyone); suggest_mode 'owner' | 'shared' (listed suggesters) |
// 'public'. A listed suggester can always view the schedule too — you must see
// a schedule to propose against it.

// Parses a stored JSON username list back into an array (malformed rows read
// as empty, never crash).
/**
 * @param {unknown} str
 * @returns {string[]}
 */
function storedNameList(str) {
  try {
    const arr = JSON.parse(String(str ?? '[]'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

// Canonicalizes + validates a username list for storage: each entry trimmed +
// lowercased (canonicalUsername, with `domain` as the default when configured),
// deduped, non-empty, length-bounded. Returns the list, or null when the input
// isn't a valid name list.
/**
 * @param {unknown} list
 * @param {string} [domain]
 * @returns {string[] | null}
 */
export function normalizeNameList(list, domain = '') {
  if (!Array.isArray(list)) return null
  const out = []
  const seen = new Set()
  for (const raw of list) {
    const name = canonicalUsername(String(raw), domain)
    if (!name) return null
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

// Whether `user` may view the schedule. The owner always can; 'public' is
// visible to every signed-in user; 'shared' only to the listed viewers. A
// listed suggester can always view too (regardless of the visibility mode):
// you must see a schedule to propose against it.
/**
 * @param {ScheduleRow} schedule
 * @param {{ id: number, username: string }} user
 * @returns {boolean}
 */
export function canViewSchedule(schedule, user) {
  if (!user) return false
  if (Number(schedule.owner_user_id) === Number(user.id)) return true
  if (schedule.visibility === 'public') return true
  if (schedule.visibility === 'shared' && schedule.viewers.includes(user.username)) return true
  return schedule.suggesters.includes(user.username)
}

// Whether `user` may propose suggestions for the schedule: the owner always
// can; 'public' lets every signed-in user; 'shared' only the listed
// suggesters.
/**
 * @param {ScheduleRow} schedule
 * @param {{ id: number, username: string }} user
 * @returns {boolean}
 */
export function canSuggestSchedule(schedule, user) {
  if (!user) return false
  if (Number(schedule.owner_user_id) === Number(user.id)) return true
  if (schedule.suggestMode === 'public') return true
  if (schedule.suggestMode === 'shared') return schedule.suggesters.includes(user.username)
  return false
}

// ---- Schedules -----------------------------------------------------------

/**
 * @param {DB} db
 * @param {{ year?: string; user?: { id: number, username: string } }} [opts]
 */
export function listSchedules(db, { year, user } = {}) {
  const clause = year != null && year !== '' ? 'WHERE s.year = ?' : ''
  const rows = /** @type {ScheduleRawRow[]} */ (
    db
      .prepare(
        `SELECT s.*, u.username AS owner FROM schedules s
       JOIN users u ON u.id = s.owner_user_id ${clause} ORDER BY s.year DESC, s.name`,
      )
      .all(...(clause ? [year] : []))
  )
  const schedules = rows.map((r) => {
    const { suggest_mode, viewers, suggesters, ...rest } = r
    return {
      ...rest,
      suggestMode: suggest_mode,
      viewers: storedNameList(viewers),
      suggesters: storedNameList(suggesters),
      terms: getTerms(db, r.id),
    }
  })
  // Full term payloads (offerings + version), the same shape `getSchedule`
  // returns — the schedule app's store renders directly from this list. A
  // `user` (the caller) narrows the list to schedules they can view.
  return user ? schedules.filter((s) => canViewSchedule(s, user)) : schedules
}

// All three term parts of a schedule with their full offering payloads.
/**
 * @param {DB} db
 * @param {number} scheduleId
 */
function getTerms(db, scheduleId) {
  const rows = /** @type {TermRow[]} */ (
    db.prepare('SELECT term, version, payload FROM schedule_terms WHERE schedule_id = ?').all(scheduleId)
  )
  const terms = {}
  for (const r of rows) {
    let offerings = []
    try {
      offerings = JSON.parse(r.payload || '[]')
    } catch {
      offerings = []
    }
    terms[r.term] = { offerings, version: r.version }
  }
  return terms
}

/**
 * @param {DB} db
 */
export function createSchedule(db, { name, year, ownerUserId }) {
  return transaction(db, (d) => {
    const info = d
      .prepare('INSERT INTO schedules (name, year, owner_user_id) VALUES (?, ?, ?)')
      .run(name, year || '', ownerUserId)
    const id = Number(info.lastInsertRowid)
    for (const term of ['F', 'W', 'S']) {
      d.prepare('INSERT INTO schedule_terms (schedule_id, term, payload) VALUES (?, ?, ?)').run(
        id,
        term,
        '[]',
      )
    }
    return getSchedule(d, id)
  })
}

/**
 * @param {DB} db
 */
export function getSchedule(db, id) {
  const row = /** @type {ScheduleRawRow | undefined} */ (
    db
      .prepare(
        'SELECT s.*, u.username AS owner FROM schedules s JOIN users u ON u.id = s.owner_user_id WHERE s.id = ?',
      )
      .get(id)
  )
  if (!row) return null
  const { suggest_mode, viewers, suggesters, ...rest } = row
  return {
    ...rest,
    suggestMode: suggest_mode,
    viewers: storedNameList(viewers),
    suggesters: storedNameList(suggesters),
    terms: getTerms(db, id),
  }
}

/**
 * @param {DB} db
 */
export function getTerm(db, scheduleId, term) {
  const row = /** @type {TermRow | undefined} */ (
    db
      .prepare('SELECT *, payload FROM schedule_terms WHERE schedule_id = ? AND term = ?')
      .get(scheduleId, term)
  )
  if (!row) return null
  let offerings = []
  try {
    offerings = JSON.parse(row.payload || '[]')
  } catch {
    offerings = []
  }
  return { schedule_id: row.schedule_id, term: row.term, version: row.version, offerings }
}

/**
 * @param {DB} db
 * @param {number} id
 * @param {{
 *   name?: string;
 *   status?: string;
 *   visibility?: 'private' | 'shared' | 'public';
 *   suggestMode?: 'owner' | 'shared' | 'public';
 *   viewers?: string[];
 *   suggesters?: string[];
 * }} meta
 */
export function updateScheduleMeta(db, id, { name, status, visibility, suggestMode, viewers, suggesters }) {
  const fields = []
  const vals = []
  if (name != null) {
    fields.push('name = ?')
    vals.push(name)
  }
  if (status != null) {
    fields.push('status = ?')
    vals.push(status)
  }
  if (visibility != null) {
    fields.push('visibility = ?')
    vals.push(visibility)
  }
  if (suggestMode != null) {
    fields.push('suggest_mode = ?')
    vals.push(suggestMode)
  }
  if (viewers != null) {
    fields.push('viewers = ?')
    vals.push(JSON.stringify(viewers))
  }
  if (suggesters != null) {
    fields.push('suggesters = ?')
    vals.push(JSON.stringify(suggesters))
  }
  if (!fields.length) return getSchedule(db, id)
  fields.push("updated_at = datetime('now')")
  db.prepare(`UPDATE schedules SET ${fields.join(', ')} WHERE id = ?`).run(...vals, id)
  return getSchedule(db, id)
}

/**
 * @param {DB} db
 */
export function deleteSchedule(db, id) {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id)
}

// Replaces a term part's offerings, incrementing its version, and bumps the
// schedule's own updated_at/version. Returns the saved term.
/**
 * @param {DB} db
 */
export function setTermOfferings(db, scheduleId, term, offerings) {
  return transaction(db, (d) => {
    // Fill missing content ids (legacy/registrar-feed rows) so a suggestion's
    // update ops always target the exact meeting row — split-meeting rows
    // (two rows sharing a section) would otherwise be indistinguishable.
    const rows = assignOfferingIds([...(offerings || [])])
    const payload = JSON.stringify(rows)
    const existing = /** @type {{ version: number } | undefined} */ (
      d.prepare('SELECT version FROM schedule_terms WHERE schedule_id = ? AND term = ?').get(scheduleId, term)
    )
    if (!existing) throw new Error('term not found')
    const version = (existing.version || 0) + 1
    d.prepare(
      `UPDATE schedule_terms SET payload = ?, version = ?, schedule_id = schedule_id WHERE schedule_id = ? AND term = ?`,
    ).run(payload, version, scheduleId, term)
    d.prepare(`UPDATE schedules SET version = version + 1, updated_at = datetime('now') WHERE id = ?`).run(
      scheduleId,
    )
    return { schedule_id: scheduleId, term, version, offerings: rows }
  })
}

// ---- Suggested changes ---------------------------------------------------

// Logs a suggested change for a term part from `proposer`. The server stores the
// operations payload and does NOT modify the canonical term until an owner
// approves it. `baseVersion` records what the proposer saw (informational): many
// suggestions from many proposers stay live concurrently, and approval applies
// the identity-based operations to whatever the current term state is — it is
// never gated on the recorded base version.
/**
 * @param {DB} db
 */
export function addSuggestion(db, { scheduleId, term, proposerUserId, baseVersion, operations, note }) {
  const existing = /** @type {{ version: number } | undefined} */ (
    db.prepare('SELECT version FROM schedule_terms WHERE schedule_id = ? AND term = ?').get(scheduleId, term)
  )
  if (!existing) throw new Error('term not found')
  const info = transaction(db, () => {
    const parent = db
      .prepare(
        `INSERT INTO schedule_changes
           (schedule_id, term, proposer_user_id, base_version, note)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(scheduleId, term, proposerUserId, baseVersion, note || '')
    const suggestionId = Number(parent.lastInsertRowid)
    insertOps(db, suggestionId, operations || [])
    return suggestionId
  })
  return getSuggestion(db, info)
}

// Replaces a pending suggestion's operations wholesale (proposer editing their
// own proposal). Only call while no op is owner-resolved — the replacement
// starts every op fresh as 'pending' (a proposer's own withdrawn ops are
// dropped by the edit; they were never applied). Returns the updated suggestion
// or null if the id is unknown.
/**
 * @param {DB} db
 * @param {number} id
 * @param {{ operations?: unknown[]; note?: string }} changes
 */
export function updateSuggestion(db, id, { operations, note }) {
  transaction(db, () => {
    if (operations !== undefined) insertOps(db, id, operations)
    if (note !== undefined) {
      db.prepare(`UPDATE schedule_changes SET note = ? WHERE id = ?`).run(note, id)
    }
  })
  return getSuggestion(db, id)
}

// Inserts the pure op payloads as fresh 'pending' suggestion_ops rows (deleting
// any existing rows for the suggestion first).
/**
 * @param {DB} db
 * @param {number} suggestionId
 * @param {unknown[]} operations
 */
function insertOps(db, suggestionId, operations) {
  db.prepare(`DELETE FROM suggestion_ops WHERE suggestion_id = ?`).run(suggestionId)
  const insert = db.prepare(`INSERT INTO suggestion_ops (suggestion_id, position, op) VALUES (?, ?, ?)`)
  ;(operations || []).forEach((op, position) => {
    insert.run(suggestionId, position, JSON.stringify(op))
  })
}

// Sets one op's resolution (status + whether applying it changed the term).
/**
 * @param {DB} db
 * @param {number} opId
 * @param {{ status: string; applied: boolean }} resolution
 */
export function setOpResolution(db, opId, { status, applied }) {
  db.prepare(
    `UPDATE suggestion_ops SET status = ?, applied = ?, resolved_at = ?
     WHERE id = ?`,
  ).run(status, applied ? 1 : 0, new Date().toISOString(), opId)
}

// Withdraws ops of a suggestion: `opIds` restricts to those ids, otherwise
// every still-pending op. Returns the number of ops withdrawn (0 when nothing
// was pending).
/**
 * @param {DB} db
 * @param {number} suggestionId
 * @param {number[] | undefined} opIds
 */
export function withdrawOps(db, suggestionId, opIds) {
  const where = opIds ? `AND id IN (${opIds.map(() => '?').join(',')})` : ''
  const params = opIds ? [...opIds] : []
  const info = db
    .prepare(
      `UPDATE suggestion_ops
       SET status = 'withdrawn', resolved_at = ?
       WHERE suggestion_id = ? AND status = 'pending' ${where}`,
    )
    .run(new Date().toISOString(), suggestionId, ...params)
  return Number(info.changes)
}

/**
 * @param {DB} db
 * @returns {SuggestionRow | null}
 */
export function getSuggestion(db, id) {
  const row = /** @type {SuggestionParentRow | undefined} */ (
    db
      .prepare(
        `SELECT c.id, c.schedule_id, c.term, c.proposer_user_id, c.base_version, c.note,
                c.created_at, p.username AS proposer
         FROM schedule_changes c
         JOIN users p ON p.id = c.proposer_user_id WHERE c.id = ?`,
      )
      .get(id)
  )
  if (!row) return null
  return composeSuggestion(db, row)
}

/**
 * @param {DB} db
 * @returns {SuggestionRow[]}
 */
export function listSuggestions(db, scheduleId) {
  const rows = /** @type {SuggestionParentRow[]} */ (
    db
      .prepare(
        `SELECT c.id, c.schedule_id, c.term, c.proposer_user_id, c.base_version, c.note,
                c.created_at, p.username AS proposer
         FROM schedule_changes c
         JOIN users p ON p.id = c.proposer_user_id
         WHERE c.schedule_id = ? ORDER BY c.created_at DESC`,
      )
      .all(scheduleId)
  )
  return rows.map((r) => composeSuggestion(db, r))
}

// Composes a suggestion row from its suggestion_ops children: the status is
// always derived from the ops ('pending' while any op is unresolved), as is
// resolved_at (max over the ops). `operations` is the first-class entry list
// [{ id, op, resolution }] in position order.
/**
 * @param {DB} db
 * @param {SuggestionParentRow} row
 * @returns {SuggestionRow}
 */
function composeSuggestion(db, row) {
  const ops = /** @type {SuggestionOpRow[]} */ (
    db
      .prepare(
        `SELECT id, position, op, status, applied, resolved_at
         FROM suggestion_ops WHERE suggestion_id = ? ORDER BY position`,
      )
      .all(row.id)
  )
  const entries = ops.map((o) => ({
    id: o.id,
    op: safeParse(o.op),
    resolution: {
      status: o.status,
      applied: Boolean(o.applied),
      resolved_at: o.resolved_at,
    },
  }))
  const status = suggestionStatus(entries) || 'pending'
  const resolvedAt =
    entries
      .map((e) => e.resolution.resolved_at)
      .filter(Boolean)
      .sort()
      .at(-1) || null
  return {
    ...row,
    status,
    resolved_at: resolvedAt,
    operations: entries,
  }
}

function safeParse(str) {
  try {
    return JSON.parse(str || '[]')
  } catch {
    return []
  }
}
