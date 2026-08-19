// The Express application (routes + middleware), built as a factory so tests can
// construct it against an in-memory DB and assertions can exercise the API
// without binding a port. Static file + catalog serving lives in index.js.
//
// Auth: an opaque session token in a cookie. Today the provider is "username"
// (self-identify); the seam (`authProvider`) leaves room for SSO / one-time-code
// later without touching the route contract.

import crypto from 'node:crypto'
import express from 'express'
import * as db from './db.js'
import { applyOperations } from './ops.js'

const TERMS = ['F', 'W', 'S']

function parseCookies(req) {
  const header = String(req.headers.cookie || '')
  const out = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = decodeURIComponent(part.slice(i + 1).trim())
    if (k) out[k] = v
  }
  return out
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// Creates the app. `options`:
//   database   — open DatabaseSync (from openDb)
//   services   — enabled service keys (for /api/config)
//   sessionCookie (string, default 'mjv_sid')
export function createApp({ database, services, sessionCookie = 'mjv_sid' }) {
  const app = express()
  app.use(express.json({ limit: '2mb' }))

  // --- Auth: resolve the session's user into req.user for authenticated routes.
  app.use((req, res, next) => {
    const token = parseCookies(req)[sessionCookie]
    if (token) {
      const user = db.sessionUser(database, hashToken(token))
      if (user) req.user = user
    }
    next()
  })

  const requireAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'not_authenticated' })
    next()
  }
  const requireOwner = (req, res, next) => {
    const schedule = db.getSchedule(database, Number(req.params.id))
    if (!schedule) return res.status(404).json({ error: 'not_found' })
    if (schedule.owner_user_id !== req.user.id) return res.status(403).json({ error: 'not_owner' })
    req.schedule = schedule
    next()
  }

  // ---- Config ------------------------------------------------------------
  app.get('/api/config', (req, res) => {
    res.json({
      services,
      auth: { provider: 'username', user: req.user ? { username: req.user.username } : null },
    })
  })

  // ---- Auth --------------------------------------------------------------
  app.post('/api/auth/login', (req, res) => {
    const username = String((req.body && req.body.username) || '').trim()
    if (!username || username.length > 120) {
      return res.status(400).json({ error: 'username_required' })
    }
    const user = db.ensureUser(database, username)
    const token = crypto.randomBytes(32).toString('hex')
    db.createSession(database, user.id, hashToken(token))
    res.cookie(sessionCookie, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86400 * 1000,
    })
    res.json({ user: { id: user.id, username: user.username } })
  })

  app.get('/api/auth/session', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'not_authenticated' })
    res.json({ user: { id: req.user.id, username: req.user.username } })
  })

  app.post('/api/auth/logout', (req, res) => {
    const token = parseCookies(req)[sessionCookie]
    if (token) db.deleteSession(database, hashToken(token))
    res.clearCookie(sessionCookie, { path: '/' })
    res.json({ ok: true })
  })

  // ---- Schedules ---------------------------------------------------------
  app.get('/api/schedules', requireAuth, (req, res) => {
    const year = typeof req.query.year === 'string' ? req.query.year : undefined
    res.json({ schedules: db.listSchedules(database, { year }) })
  })

  app.post('/api/schedules', requireAuth, (req, res) => {
    const name = String((req.body && req.body.name) || '').trim()
    if (!name) return res.status(400).json({ error: 'name_required' })
    const year = String((req.body && req.body.year) || '').trim()
    const schedule = db.createSchedule(database, { name, year, ownerUserId: req.user.id })
    res.status(201).json({ schedule })
  })

  app.get('/api/schedules/:id', requireAuth, (req, res) => {
    const schedule = db.getSchedule(database, Number(req.params.id))
    if (!schedule) return res.status(404).json({ error: 'not_found' })
    res.json({ schedule })
  })

  app.patch('/api/schedules/:id', requireAuth, requireOwner, (req, res) => {
    const name = req.body && typeof req.body.name === 'string' ? req.body.name.trim() : undefined
    const status = req.body && typeof req.body.status === 'string' ? req.body.status : undefined
    if (status !== undefined && !['draft', 'official'].includes(status))
      return res.status(400).json({ error: 'bad_status' })
    if (name !== undefined && name === '') return res.status(400).json({ error: 'name_required' })
    const schedule = db.updateScheduleMeta(database, req.schedule.id, {
      name: name || undefined,
      status,
    })
    res.json({ schedule })
  })

  app.delete('/api/schedules/:id', requireAuth, requireOwner, (req, res) => {
    db.deleteSchedule(database, req.schedule.id)
    res.json({ ok: true })
  })

  // ---- Term parts --------------------------------------------------------
  app.get('/api/schedules/:id/terms/:term', requireAuth, (req, res) => {
    if (!TERMS.includes(req.params.term)) return res.status(400).json({ error: 'bad_term' })
    const term = db.getTerm(database, Number(req.params.id), req.params.term)
    if (!term) return res.status(404).json({ error: 'not_found' })
    res.json({ term })
  })

  // Owner replaces a term's offerings (full replace, registrar-feed style).
  app.put('/api/schedules/:id/terms/:term', requireAuth, requireOwner, (req, res) => {
    if (!TERMS.includes(req.params.term)) return res.status(400).json({ error: 'bad_term' })
    const offerings = Array.isArray(req.body && req.body.offerings) ? req.body.offerings : null
    if (!offerings) return res.status(400).json({ error: 'offerings_required' })
    const term = db.setTermOfferings(database, req.schedule.id, req.params.term, offerings)
    res.json({ term })
  })

  // ---- Suggested changes -------------------------------------------------
  // A non-owner (or anyone) submits a suggestion against a term's current
  // version. The server stores it; the owner reviews/approves. The proposed
  // change is expressed as diff operations; applying requires the base version
  // to still match (stale-base guard).
  app.post('/api/schedules/:id/suggestions', requireAuth, (req, res) => {
    const schedule = db.getSchedule(database, Number(req.params.id))
    if (!schedule) return res.status(404).json({ error: 'not_found' })
    const term = req.body && req.body.term
    if (!TERMS.includes(term)) return res.status(400).json({ error: 'bad_term' })
    const operations = Array.isArray(req.body && req.body.operations) ? req.body.operations : []
    const baseVersion = Number(req.body && req.body.baseVersion)
    if (!Number.isInteger(baseVersion) || baseVersion < 0)
      return res.status(400).json({ error: 'base_version_required' })
    const current = db.getTerm(database, schedule.id, term)
    if (!current) return res.status(404).json({ error: 'not_found' })
    // The base version must match the current term version (the suggestion
    // was built against the latest published state).
    if (current.version !== baseVersion) {
      return res.status(409).json({ error: 'stale_base', currentVersion: current.version })
    }
    const note = String((req.body && req.body.note) || '').trim()
    const suggestion = db.addSuggestion(database, {
      scheduleId: schedule.id,
      term,
      proposerUserId: req.user.id,
      baseVersion,
      operations,
      note,
    })
    res.status(201).json({ suggestion })
  })

  app.get('/api/schedules/:id/suggestions', requireAuth, (req, res) => {
    const schedule = db.getSchedule(database, Number(req.params.id))
    if (!schedule) return res.status(404).json({ error: 'not_found' })
    const all = db.listSuggestions(database, schedule.id)
    // Everyone sees the owner's own schedules' suggestions; non-owners see only
    // their own proposals (privacy).
    const visible =
      schedule.owner_user_id === req.user.id ? all : all.filter((c) => c.proposer_user_id === req.user.id)
    res.json({ suggestions: visible })
  })

  // Owner applies a pending suggestion against its base version.
  app.post('/api/suggestions/:id/approve', requireAuth, (req, res) => {
    const suggestion = db.getSuggestion(database, Number(req.params.id))
    if (!suggestion) return res.status(404).json({ error: 'not_found' })
    if (suggestion.status !== 'pending') return res.status(409).json({ error: 'not_pending' })
    const schedule = db.getSchedule(database, suggestion.schedule_id)
    if (!schedule || schedule.owner_user_id !== req.user.id)
      return res.status(403).json({ error: 'not_owner' })
    const current = db.getTerm(database, schedule.id, suggestion.term)
    if (!current) return res.status(404).json({ error: 'not_found' })
    if (current.version !== suggestion.base_version) {
      return res.status(409).json({ error: 'stale_base', currentVersion: current.version })
    }
    const applied = applyOperations(current.offerings, suggestion.operations)
    const saved = db.setTermOfferings(database, schedule.id, suggestion.term, applied)
    db.setSuggestionStatus(database, suggestion.id, 'approved')
    res.json({ term: saved })
  })

  app.post('/api/suggestions/:id/reject', requireAuth, (req, res) => {
    const suggestion = db.getSuggestion(database, Number(req.params.id))
    if (!suggestion) return res.status(404).json({ error: 'not_found' })
    const schedule = db.getSchedule(database, suggestion.schedule_id)
    if (!schedule || schedule.owner_user_id !== req.user.id)
      return res.status(403).json({ error: 'not_owner' })
    if (suggestion.status !== 'pending') return res.status(409).json({ error: 'not_pending' })
    db.setSuggestionStatus(database, suggestion.id, 'rejected')
    res.json({ ok: true })
  })

  app.get('/api/schedules/:id/suggestions/export', requireAuth, (req, res) => {
    const schedule = db.getSchedule(database, Number(req.params.id))
    if (!schedule) return res.status(404).json({ error: 'not_found' })
    const all = db.listSuggestions(database, schedule.id)
    const visible =
      schedule.owner_user_id === req.user.id ? all : all.filter((c) => c.proposer_user_id === req.user.id)
    const fmt = req.query.fmt === 'json' || !req.query.fmt ? 'json' : req.query.fmt === 'md' ? 'md' : 'csv'
    if (fmt === 'md') {
      const lines = visible.map((c) => {
        const ops = (c.operations || []).map((op) => describeOp(op)).join('; ')
        return `- **Suggestion #${c.id}** (${c.term}, by ${c.proposer}): ${ops || '(empty)'}${c.note ? ' — ' + c.note : ''} [${c.status}]`
      })
      return res.type('text/markdown').send(lines.join('\n') || '_No suggestions._')
    }
    if (fmt === 'csv') {
      const rows = [['id', 'term', 'proposer', 'status', 'base_version', 'change']]
      for (const c of visible) {
        const desc = (c.operations || []).map((op) => describeOp(op)).join('; ')
        rows.push([c.id, c.term, c.proposer, c.status, c.base_version, desc || '(empty)'])
      }
      const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n')
      return res.type('text/csv').send(csv)
    }
    res.json({ suggestions: visible })
  })

  // ---- Error handling ----------------------------------------------------
  app.use((err, req, res, next) => {
    void next
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' })
    console.error(err)
    res.status(500).json({ error: 'internal_error' })
  })

  return app
}

function csvCell(value) {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// Human-readable description of a single op (used in exports; Phase 4's diff
// module will produce richer descriptions like "CS 220: change instructor...").
function describeOp(op) {
  if (!op) return ''
  if (op.kind === 'add')
    return `add ${op.offering && op.offering.prefix} ${op.offering && op.offering.number}${op.offering && op.offering.section ? op.offering.section : ''}`
  if (op.kind === 'remove')
    return `remove ${op.cur.prefix} ${op.cur.number}${op.cur.section ? op.cur.section : ''}`
  if (op.kind === 'update') {
    const bits = Object.entries(op.changes || {})
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `set ${k}=${v}`)
    return `update ${op.cur.prefix} ${op.cur.number}${op.cur.section ? op.cur.section : ''}: ${bits.join(', ') || 'no changes'}`
  }
  return JSON.stringify(op)
}
