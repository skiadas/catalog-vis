// The Express application (routes + middleware), built as a factory so tests can
// construct it against an in-memory DB and assertions can exercise the API
// without binding a port. Static file + catalog serving lives in index.js.
//
// Auth: an opaque session token in a cookie. The provider is chosen at boot —
// `username` (self-identify; dev + tests) or `oidc` (external OpenID Connect
// issuer, see ./auth/oidc.js). Either way the route contract the apps see is
// the same: /api/config advertises the provider, /api/auth/session reports the
// user, /api/auth/logout clears the session.

import crypto from 'node:crypto'
import express from 'express'
import * as db from './db.js'
import { createOidcProvider } from './auth/oidc.js'
import { canonicalUsername } from './names.js'
import { applyOperations, diffOfferings, describeChange } from '@major-vis/schedule-core/diff'

const TERMS = ['F', 'W', 'S']

// The suggestion a resolve request names an op of, or null when the opId is
// unknown. Ops are first-class (suggestion_ops rows), so resolution targets an
// op id, never a position.
function entryFor(suggestion, opId) {
  const id = Number(opId)
  const entry = (suggestion.operations || []).find((e) => Number(e.id) === id)
  return entry || null
}

// Whether any op of the suggestion has been decided by the owner — the
// proposal is "in review" and the proposer may no longer replace its ops.
function inReview(suggestion) {
  return (suggestion.operations || []).some((e) => {
    const status = e.resolution && e.resolution.status
    return status === 'accepted' || status === 'rejected'
  })
}

// The prefix an op touches: the added offering, or the course it removes or
// updates.
function opPrefix(op) {
  if (!op) return ''
  if (op.kind === 'add') return String((op.offering && op.offering.prefix) || '')
  return String((op.cur && op.cur.prefix) || '')
}

// Renders the ops of a suggestion with their resolution statuses appended for
// the export trail ("CS 220 A: ... [accepted]"); pending ops render bare.
function renderOpsWithStatuses(operations) {
  return (operations || []).map((e) => {
    const text = describeChange(e.op)
    const status = e.resolution && e.resolution.status
    return !status || status === 'pending' ? text : `${text} [${status}]`
  })
}

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
//   auth       — auth config from loadConfig (provider + cookie flag + oidc coordinates)
/**
 * @param {{
 *   database: import('node:sqlite').DatabaseSync,
 *   services: string[],
 *   sessionCookie?: string,
 *   auth?: import('./config.js').AuthConfig,
 *   authDomain?: string,
 *   adminUsernames?: Set<string>,
 * }} options
 */
export function createApp({
  database,
  services,
  sessionCookie = 'mjv_sid',
  auth = { provider: 'username', cookieSecure: false },
  authDomain = '',
  adminUsernames = new Set(),
}) {
  const app = express()
  const authProvider = auth.provider || 'username'
  app.use(express.json({ limit: '2mb' }))

  // Creates a session row + sets the opaque session cookie. The single place
  // session policy lives, shared by both providers.
  function startSession(res, user) {
    const token = crypto.randomBytes(32).toString('hex')
    db.createSession(database, user.id, hashToken(token))
    res.cookie(sessionCookie, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: !!auth.cookieSecure,
      maxAge: 30 * 86400 * 1000,
    })
  }

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
  // Whether `user` is an administrator (from the ADMIN_USERNAMES config).
  const isAdminUser = (user) => Boolean(user && adminUsernames.has(String(user.username)))
  // The user's directory entry (display name + departments), or null.
  const directoryEntry = (user) => (user ? db.getDirectoryUser(database, user.id) : null)
  // The user object the app sees — admin + departments are part of the
  // identity contract so the UI can show the directory controls and gate
  // suggest sessions to the user's own departments.
  const userJson = (user) => {
    const entry = directoryEntry(user)
    return {
      id: user.id,
      username: user.username,
      admin: isAdminUser(user),
      departments: (entry && entry.departments) || [],
    }
  }
  const requireAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'not_authenticated' })
    if (!isAdminUser(req.user)) return res.status(403).json({ error: 'not_admin' })
    next()
  }
  // The departments a user belongs to (from the admin-maintained directory),
  // as a Set of prefixes; empty for non-directory users.
  const departmentSet = (user) => new Set(userJson(user).departments)
  // The dept-scoping verdict for a non-owner's op list: null when every op
  // touches one of the user's directory departments, else the 403 body naming
  // the offending courses (`dept_restricted` + codes).
  const deptBlocked = (operations, user) => {
    if (!Array.isArray(operations)) return null
    const mine = departmentSet(user)
    const outOfScope = operations.filter((op) => op && !mine.has(opPrefix(op)))
    if (!outOfScope.length) return null
    const codes = outOfScope
      .map((op) => `${opPrefix(op)} ${op.kind === 'add' ? op.offering.number : op.cur.number}`)
      .join(', ')
    return { error: 'dept_restricted', codes }
  }
  const requireOwner = (req, res, next) => {
    const schedule = db.getSchedule(database, Number(req.params.id))
    if (!schedule) return res.status(404).json({ error: 'not_found' })
    if (schedule.owner_user_id !== req.user.id) return res.status(403).json({ error: 'not_owner' })
    req.schedule = schedule
    next()
  }
  // Reads a schedule the user may view: the owner, everyone for 'public',
  // listed viewers for 'shared' — and listed suggesters always (you must see
  // a schedule to propose against it). Anyone else gets 404 — a private
  // schedule must not even leak its existence.
  const requireView = (req, res, next) => {
    const schedule = db.getSchedule(database, Number(req.params.id))
    if (!schedule) return res.status(404).json({ error: 'not_found' })
    if (!db.canViewSchedule(schedule, req.user)) return res.status(404).json({ error: 'not_found' })
    req.schedule = schedule
    next()
  }
  // Writes a suggestion for a schedule the user may propose against: the
  // owner, everyone for 'public', listed suggesters for 'shared'. Non-viewers
  // are 404'd (they shouldn't know the schedule exists); viewers who may not
  // suggest get a clear 403.
  const requireSuggest = (req, res, next) => {
    const schedule = db.getSchedule(database, Number(req.params.id))
    if (!schedule) return res.status(404).json({ error: 'not_found' })
    if (!db.canViewSchedule(schedule, req.user)) return res.status(404).json({ error: 'not_found' })
    if (!db.canSuggestSchedule(schedule, req.user)) return res.status(403).json({ error: 'not_suggester' })
    req.schedule = schedule
    next()
  }

  // ---- Config ------------------------------------------------------------
  app.get('/api/config', (req, res) => {
    res.json({
      services,
      auth: { provider: authProvider, user: req.user ? userJson(req.user) : null },
    })
  })

  // ---- Auth --------------------------------------------------------------
  if (authProvider === 'oidc') {
    // Login is a full-page redirect dance at the issuer: the app links to
    // /api/auth/login and the issuer returns the browser to /api/auth/callback.
    // The self-identify POST below is intentionally absent — with a real
    // identity provider, a client-supplied username would let anyone claim any
    // email.
    const oidc = createOidcProvider({
      database,
      issuer: auth.oidc.issuer,
      clientId: auth.oidc.clientId,
      clientSecret: auth.oidc.clientSecret,
      redirectUri: auth.oidc.redirectUri,
      publicOrigin: auth.oidc.publicOrigin,
      allowInsecureIssuer: auth.oidc.allowInsecureIssuer,
      startSession,
    })
    app.get('/api/auth/login', oidc.loginHandler)
    app.get('/api/auth/callback', oidc.callbackHandler)
  } else {
    app.post('/api/auth/login', (req, res) => {
      const username = canonicalUsername(req.body && req.body.username, authDomain)
      if (!username) return res.status(400).json({ error: 'username_required' })
      const user = db.ensureUser(database, username)
      startSession(res, user)
      res.json({ user: userJson(user) })
    })
  }

  // Reports the current session's user, or user:null when unauthenticated (the
  // store treats a missing session as data, not an error — mirrors /api/config).
  app.get('/api/auth/session', (req, res) => {
    res.json({ user: req.user ? userJson(req.user) : null })
  })

  app.post('/api/auth/logout', (req, res) => {
    const token = parseCookies(req)[sessionCookie]
    if (token) db.deleteSession(database, hashToken(token))
    res.clearCookie(sessionCookie, { path: '/' })
    res.json({ ok: true })
  })

  // ---- User directory (admin-maintained) --------------------------------
  // Admins keep the directory over the JIT-provisioned accounts: display
  // names (shown instead of bare usernames) and the departments each user
  // belongs to (the scope for whose suggestions may touch which courses).
  // Accounts can be pre-created before the person ever signs in.
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    res.json({ users: db.listUsers(database) })
  })

  app.post('/api/admin/users', requireAdmin, (req, res) => {
    const username = canonicalUsername(req.body && req.body.username, authDomain)
    if (!username) return res.status(400).json({ error: 'username_required' })
    const displayName =
      req.body && req.body.displayName != null ? String(req.body.displayName).trim() || null : undefined
    const departments =
      req.body && req.body.departments !== undefined
        ? db.normalizePrefixList(req.body.departments)
        : undefined
    if (req.body && req.body.departments !== undefined && !departments)
      return res.status(400).json({ error: 'bad_departments' })
    const user = db.ensureUser(database, username)
    const entry = db.setUserDirectory(database, user.id, { displayName, departments })
    res.status(201).json({ user: entry })
  })

  app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id)
    const displayName =
      req.body && req.body.displayName != null ? String(req.body.displayName).trim() || null : undefined
    const departments =
      req.body && req.body.departments !== undefined
        ? db.normalizePrefixList(req.body.departments)
        : undefined
    if (req.body && req.body.departments !== undefined && !departments)
      return res.status(400).json({ error: 'bad_departments' })
    if (displayName === undefined && departments === undefined)
      return res.status(400).json({ error: 'nothing_to_update' })
    const entry = db.setUserDirectory(database, id, { displayName, departments })
    if (!entry) return res.status(404).json({ error: 'not_found' })
    res.json({ user: entry })
  })

  // Username autocomplete for the access dialogs: any signed-in user can look
  // up accounts in the directory by username or display name (names only —
  // no schedule data). Returns a bounded list of { username, displayName }.
  app.get('/api/users', requireAuth, (req, res) => {
    const q = String(req.query.q || '')
      .trim()
      .toLowerCase()
    const users = db.listUsers(database)
    const matches = q
      ? users.filter(
          (u) =>
            u.username.toLowerCase().includes(q) ||
            String(u.displayName || '')
              .toLowerCase()
              .includes(q),
        )
      : users
    res.json({ users: matches.slice(0, 8) })
  })

  // ---- Schedules ---------------------------------------------------------
  // The list is filtered to schedules the caller may view: everything for
  // 'public', listed viewers/suggesters for 'shared', owner-only for 'private'.
  app.get('/api/schedules', requireAuth, (req, res) => {
    const year = typeof req.query.year === 'string' ? req.query.year : undefined
    res.json({ schedules: db.listSchedules(database, { year, user: req.user }) })
  })

  app.post('/api/schedules', requireAuth, (req, res) => {
    const name = String((req.body && req.body.name) || '').trim()
    if (!name) return res.status(400).json({ error: 'name_required' })
    const year = String((req.body && req.body.year) || '').trim()
    const schedule = db.createSchedule(database, { name, year, ownerUserId: req.user.id })
    res.status(201).json({ schedule })
  })

  app.get('/api/schedules/:id', requireAuth, requireView, (req, res) => {
    res.json({ schedule: req.schedule })
  })

  app.patch('/api/schedules/:id', requireAuth, requireOwner, (req, res) => {
    const name = req.body && typeof req.body.name === 'string' ? req.body.name.trim() : undefined
    const status = req.body && typeof req.body.status === 'string' ? req.body.status : undefined
    const visibility = req.body && typeof req.body.visibility === 'string' ? req.body.visibility : undefined
    const suggestMode =
      req.body && typeof req.body.suggestMode === 'string' ? req.body.suggestMode : undefined
    if (status !== undefined && !['draft', 'official'].includes(status))
      return res.status(400).json({ error: 'bad_status' })
    if (name !== undefined && name === '') return res.status(400).json({ error: 'name_required' })
    if (visibility !== undefined && !['private', 'shared', 'public'].includes(visibility))
      return res.status(400).json({ error: 'bad_visibility' })
    if (suggestMode !== undefined && !['owner', 'shared', 'public'].includes(suggestMode))
      return res.status(400).json({ error: 'bad_suggest_mode' })
    const viewers =
      req.body && req.body.viewers !== undefined
        ? db.normalizeNameList(req.body.viewers, authDomain)
        : undefined
    const suggesters =
      req.body && req.body.suggesters !== undefined
        ? db.normalizeNameList(req.body.suggesters, authDomain)
        : undefined
    if (req.body && req.body.viewers !== undefined && !viewers)
      return res.status(400).json({ error: 'bad_viewers' })
    if (req.body && req.body.suggesters !== undefined && !suggesters)
      return res.status(400).json({ error: 'bad_suggesters' })
    const schedule = db.updateScheduleMeta(database, req.schedule.id, {
      name: name || undefined,
      status,
      visibility,
      suggestMode,
      viewers,
      suggesters,
    })
    res.json({ schedule })
  })

  app.delete('/api/schedules/:id', requireAuth, requireOwner, (req, res) => {
    db.deleteSchedule(database, req.schedule.id)
    res.json({ ok: true })
  })

  // ---- Term parts --------------------------------------------------------
  app.get('/api/schedules/:id/terms/:term', requireAuth, requireView, (req, res) => {
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
  // Anyone proposes a change to a term as identity-based diff operations
  // (add/remove/update with absolute values). Ops are first-class: each one is
  // stored as its own suggestion_ops row, so the owner resolves the changes of
  // a suggestion individually (accepted/rejected) and the proposer can pull
  // their own changes back (withdrawn). The suggestion's status is always
  // derived from its ops. Many suggestions from many proposers stay live
  // concurrently: approving one op never invalidates others — it applies to
  // whatever the term's current state is (unmatched ops no-op, duplicate adds
  // dedupe). `baseVersion` is recorded for the paper trail only, never enforced.
  app.post('/api/schedules/:id/suggestions', requireAuth, requireSuggest, (req, res) => {
    const schedule = req.schedule
    // A non-owner's proposal is scoped to the departments in their directory
    // entry: every op must touch one of their prefixes (an empty entry allows
    // nothing). The owner is exempt — their own schedule.
    if (schedule.owner_user_id !== req.user.id) {
      const blocked = deptBlocked(req.body && req.body.operations, req.user)
      if (blocked) return res.status(403).json(blocked)
    }
    const term = req.body && req.body.term
    if (!TERMS.includes(term)) return res.status(400).json({ error: 'bad_term' })
    const operations = Array.isArray(req.body && req.body.operations) ? req.body.operations : []
    const baseVersion = Number(req.body && req.body.baseVersion)
    if (!Number.isInteger(baseVersion) || baseVersion < 0)
      return res.status(400).json({ error: 'base_version_required' })
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

  app.get('/api/schedules/:id/suggestions', requireAuth, requireView, (req, res) => {
    const schedule = req.schedule
    const all = db.listSuggestions(database, schedule.id)
    // Everyone sees the live (pending) suggestions from every proposer so
    // departments can coordinate; history (approved/rejected/withdrawn/moot) is
    // visible to the owner and to the row's own proposer. `status` is derived
    // from the ops, so 'pending' here means "some op is still unresolved".
    const visible =
      schedule.owner_user_id === req.user.id
        ? all
        : all.filter((c) => c.status === 'pending' || c.proposer_user_id === req.user.id)
    res.json({ suggestions: visible })
  })

  // A proposer can edit their own pending suggestion (new operations and/or
  // note); pending only, so the trail is stable once resolved. Editing is also
  // refused once the owner has resolved any operation ('in_review') — partial
  // resolutions address ops by id, and the proposal's remaining changes must
  // not move mid-review. The proposer's own outlined ops don't freeze the list
  // (they can always withdraw individually); ops replaced by an edit restart
  // as pending, dropping withdrawn ones that were never applied.
  app.patch('/api/suggestions/:id', requireAuth, (req, res) => {
    const suggestion = db.getSuggestion(database, Number(req.params.id))
    if (!suggestion) return res.status(404).json({ error: 'not_found' })
    if (suggestion.proposer_user_id !== req.user.id) return res.status(403).json({ error: 'not_proposer' })
    if (suggestion.status !== 'pending') return res.status(409).json({ error: 'not_pending' })
    if (inReview(suggestion)) return res.status(409).json({ error: 'in_review' })
    const operations = Array.isArray(req.body && req.body.operations) ? req.body.operations : undefined
    const note = req.body && typeof req.body.note === 'string' ? req.body.note.trim() : undefined
    if (operations === undefined && note === undefined)
      return res.status(400).json({ error: 'nothing_to_update' })
    // A non-owner replacing their ops is dept-scoped like a fresh proposal:
    // the replacement must not touch departments outside their entry.
    if (operations !== undefined && suggestion.proposer_user_id === req.user.id) {
      const schedule = db.getSchedule(database, suggestion.schedule_id)
      if (schedule && schedule.owner_user_id !== req.user.id) {
        const blocked = deptBlocked(operations, req.user)
        if (blocked) return res.status(403).json(blocked)
      }
    }
    const updated = db.updateSuggestion(database, suggestion.id, {
      ...(operations !== undefined ? { operations } : {}),
      ...(note !== undefined ? { note } : {}),
    })
    res.json({ suggestion: updated })
  })

  // A proposer withdraws their own pending changes: one op (with `opId`), or
  // every remaining pending op of the proposal (the convenience form). Owner-
  // decided ops (accepted/rejected) are never touched; withdrawal is a soft
  // status — the op stays in the trail as 'withdrawn'.
  app.post('/api/suggestions/:id/withdraw', requireAuth, (req, res) => {
    const suggestion = db.getSuggestion(database, Number(req.params.id))
    if (!suggestion) return res.status(404).json({ error: 'not_found' })
    if (suggestion.proposer_user_id !== req.user.id) return res.status(403).json({ error: 'not_proposer' })
    if (suggestion.status !== 'pending') return res.status(409).json({ error: 'not_pending' })
    const opIds = req.body && req.body.opId != null ? [Number(req.body.opId)] : undefined
    if (opIds) {
      const entry = entryFor(suggestion, opIds[0])
      if (!entry) return res.status(400).json({ error: 'bad_op' })
      if (entry.resolution.status !== 'pending') return res.status(409).json({ error: 'already_resolved' })
    }
    const withdrawn = db.withdrawOps(database, suggestion.id, opIds)
    if (!withdrawn) return res.status(409).json({ error: 'nothing_pending' })
    res.json({ suggestion: db.getSuggestion(database, suggestion.id) })
  })

  // Owner resolves one operation of a pending suggestion against the current
  // term state: approving applies exactly that op (unmatched ops no-op, so
  // concurrent suggestions from many proposers each stay live), rejecting
  // records the decision without changing the term, and the proposal stays
  // 'pending' until every op is resolved — the trail reflects what actually
  // happened, one change at a time.
  app.post('/api/suggestions/:id/approve', requireAuth, (req, res) => {
    const suggestion = db.getSuggestion(database, Number(req.params.id))
    if (!suggestion) return res.status(404).json({ error: 'not_found' })
    if (suggestion.status !== 'pending') return res.status(409).json({ error: 'not_pending' })
    const schedule = db.getSchedule(database, suggestion.schedule_id)
    if (!schedule || schedule.owner_user_id !== req.user.id)
      return res.status(403).json({ error: 'not_owner' })
    const entry = entryFor(suggestion, req.body && req.body.opId)
    if (!entry) return res.status(400).json({ error: 'bad_op' })
    if (entry.resolution.status !== 'pending') return res.status(409).json({ error: 'already_resolved' })
    const current = db.getTerm(database, schedule.id, suggestion.term)
    if (!current) return res.status(404).json({ error: 'not_found' })
    const appliedOff = applyOperations(current.offerings, [entry.op])
    const changed = diffOfferings(current.offerings, appliedOff).length > 0
    const term = changed ? db.setTermOfferings(database, schedule.id, suggestion.term, appliedOff) : current
    db.setOpResolution(database, entry.id, { status: 'accepted', applied: changed })
    res.json({ term, suggestion: db.getSuggestion(database, suggestion.id) })
  })

  app.post('/api/suggestions/:id/reject', requireAuth, (req, res) => {
    const suggestion = db.getSuggestion(database, Number(req.params.id))
    if (!suggestion) return res.status(404).json({ error: 'not_found' })
    if (suggestion.status !== 'pending') return res.status(409).json({ error: 'not_pending' })
    const schedule = db.getSchedule(database, suggestion.schedule_id)
    if (!schedule || schedule.owner_user_id !== req.user.id)
      return res.status(403).json({ error: 'not_owner' })
    const entry = entryFor(suggestion, req.body && req.body.opId)
    if (!entry) return res.status(400).json({ error: 'bad_op' })
    if (entry.resolution.status !== 'pending') return res.status(409).json({ error: 'already_resolved' })
    db.setOpResolution(database, entry.id, { status: 'rejected', applied: false })
    res.json({ suggestion: db.getSuggestion(database, suggestion.id) })
  })

  app.get('/api/schedules/:id/suggestions/export', requireAuth, requireView, (req, res) => {
    const schedule = req.schedule
    const all = db.listSuggestions(database, schedule.id)
    const visible =
      schedule.owner_user_id === req.user.id
        ? all
        : all.filter((c) => c.status === 'pending' || c.proposer_user_id === req.user.id)
    const fmt = req.query.fmt === 'json' || !req.query.fmt ? 'json' : req.query.fmt === 'md' ? 'md' : 'csv'
    if (fmt === 'md') {
      const lines = visible.map((c) => {
        const ops = renderOpsWithStatuses(c.operations).join('; ') || '(empty)'
        return `- **Suggestion #${c.id}** (${c.term}, by ${c.proposer}): ${ops}${c.note ? ' — ' + c.note : ''} [${c.status}]`
      })
      return res.type('text/markdown').send(lines.join('\n') || '_No suggestions._')
    }
    if (fmt === 'csv') {
      const rows = [['id', 'term', 'proposer', 'status', 'base_version', 'change']]
      for (const c of visible) {
        const desc = renderOpsWithStatuses(c.operations).join('; ')
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
