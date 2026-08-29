// SQLite access layer via the built-in `node:sqlite` (Node >= 22.5, zero
// external dependencies). Owns the schema, migrations, and the repository
// functions for users, sessions, schedules, term parts, and suggested changes.
//
// The supertype distinction: schedule *records* (name/year/owner/status) with
// versioned *term parts* (payload = offerings). A suggested change targets one
// term part, records the base version + diff operations it was built against,
// and can be applied (owner) atomically with a version guard.

import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'

/** @typedef {import('node:sqlite').DatabaseSync} DB */

// Row shapes for the SELECTs below. Columns come from the migrations; the
// repository functions return typed rows so the rest of the server is typed
// against real names rather than raw `Record<string, any>`.
/**
 * @typedef {object} UserRow
 * @property {number} id
 * @property {string} username
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
 * @property {string} operations
 * @property {string} status
 * @property {string} note
 * @property {string | null} proposer
 */

const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
  `,
  `
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    year TEXT NOT NULL DEFAULT '',
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'draft',   -- 'draft' | 'official'
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS schedule_terms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    term TEXT NOT NULL,                    -- 'F' | 'W' | 'S'
    payload TEXT NOT NULL DEFAULT '[]',    -- JSON offerings array
    version INTEGER NOT NULL DEFAULT 0,
    UNIQUE(schedule_id, term)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS schedule_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    proposer_user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
    base_version INTEGER NOT NULL,
    operations TEXT NOT NULL DEFAULT '[]',  -- JSON diff ops
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );
  `,
]

export function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  for (const migration of MIGRATIONS) db.exec(migration)
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

// ---- Schedules -----------------------------------------------------------

/**
 * @param {DB} db
 * @param {{ year?: string }} [opts]
 */
export function listSchedules(db, { year } = {}) {
  const clause = year != null && year !== '' ? 'WHERE s.year = ?' : ''
  const rows = /** @type {ScheduleRow[]} */ (
    db
      .prepare(
        `SELECT s.*, u.username AS owner FROM schedules s
       JOIN users u ON u.id = s.owner_user_id ${clause} ORDER BY s.year DESC, s.name`,
      )
      .all(...(clause ? [year] : []))
  )
  return rows.map((r) => ({ ...r, terms: termSummary(db, r.id) }))
}

// Per-term offering counts + versions, for list summaries.
/**
 * @param {DB} db
 */
function termSummary(db, scheduleId) {
  const rows = /** @type {TermRow[]} */ (
    db.prepare('SELECT term, version, payload FROM schedule_terms WHERE schedule_id = ?').all(scheduleId)
  )
  const summary = { F: { count: 0, version: 0 }, W: { count: 0, version: 0 }, S: { count: 0, version: 0 } }
  for (const r of rows) {
    try {
      summary[r.term] = { count: JSON.parse(r.payload || '[]').length, version: r.version }
    } catch {
      summary[r.term] = { count: 0, version: r.version }
    }
  }
  return summary
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
  const row = /** @type {ScheduleRow | undefined} */ (
    db
      .prepare(
        'SELECT s.*, u.username AS owner FROM schedules s JOIN users u ON u.id = s.owner_user_id WHERE s.id = ?',
      )
      .get(id)
  )
  if (!row) return null
  const terms = {}
  const termRows = /** @type {TermRow[]} */ (
    db.prepare('SELECT term, version, payload FROM schedule_terms WHERE schedule_id = ?').all(id)
  )
  for (const r of termRows) {
    let offerings = []
    try {
      offerings = JSON.parse(r.payload || '[]')
    } catch {
      offerings = []
    }
    terms[r.term] = { offerings, version: r.version }
  }
  return { ...row, terms }
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
 */
export function updateScheduleMeta(db, id, { name, status }) {
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
    const payload = JSON.stringify(offerings || [])
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
    return { schedule_id: scheduleId, term, version, offerings: offerings || [] }
  })
}

// ---- Suggested changes ---------------------------------------------------

// Logs a suggested change for a term part from `proposer`. The server stores the
// operations payload and does NOT modify the canonical term until an owner
// approves it against the recorded base version.
/**
 * @param {DB} db
 */
export function addSuggestion(db, { scheduleId, term, proposerUserId, baseVersion, operations, note }) {
  const existing = /** @type {{ version: number } | undefined} */ (
    db.prepare('SELECT version FROM schedule_terms WHERE schedule_id = ? AND term = ?').get(scheduleId, term)
  )
  if (!existing) throw new Error('term not found')
  const info = db
    .prepare(
      `INSERT INTO schedule_changes
         (schedule_id, term, proposer_user_id, base_version, operations, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(scheduleId, term, proposerUserId, baseVersion, JSON.stringify(operations || []), note || '')
  return getSuggestion(db, Number(info.lastInsertRowid))
}

/**
 * @param {DB} db
 */
export function getSuggestion(db, id) {
  const row = /** @type {SuggestionRow | undefined} */ (
    db
      .prepare(
        `SELECT c.*, p.username AS proposer FROM schedule_changes c
       JOIN users p ON p.id = c.proposer_user_id WHERE c.id = ?`,
      )
      .get(id)
  )
  if (!row) return null
  return { ...row, operations: safeParse(row.operations) }
}

/**
 * @param {DB} db
 */
export function listSuggestions(db, scheduleId) {
  const rows = /** @type {SuggestionRow[]} */ (
    db
      .prepare(
        `SELECT c.*, p.username AS proposer FROM schedule_changes c
       JOIN users p ON p.id = c.proposer_user_id
       WHERE c.schedule_id = ? ORDER BY c.created_at DESC`,
      )
      .all(scheduleId)
  )
  return rows.map((r) => ({ ...r, operations: safeParse(r.operations) }))
}

/**
 * @param {DB} db
 */
export function setSuggestionStatus(db, id, status) {
  const resolved = status === 'pending' ? null : new Date().toISOString()
  db.prepare(`UPDATE schedule_changes SET status = ?, resolved_at = ? WHERE id = ?`).run(status, resolved, id)
  return getSuggestion(db, id)
}

function safeParse(str) {
  try {
    return JSON.parse(str || '[]')
  } catch {
    return []
  }
}
