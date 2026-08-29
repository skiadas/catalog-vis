import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.js'
import { createApp } from '../src/app.js'
import { startTestServer } from './helpers.mjs'
import { diffOfferings } from '@major-vis/schedule-core/diff'

// A self-contained client: fresh in-memory DB + server + a logged-in username.
async function authClient(username = 'alice') {
  const database = openDb(':memory:')
  const app = createApp({ database, services: ['schedule'] })
  const srv = await startTestServer(app)
  const login = await srv.post('/api/auth/login', { username })
  assert.equal(login.status, 200)
  return { srv, db: database }
}

test('config reports enabled services and anonymous auth', async () => {
  const database = openDb(':memory:')
  const app = createApp({ database, services: ['schedule', 'program'] })
  const srv = await startTestServer(app)
  try {
    const res = await srv.get('/api/config')
    assert.equal(res.status, 200)
    assert.deepEqual(res.json.services, ['schedule', 'program'])
    assert.equal(res.json.auth.provider, 'username')
    assert.equal(res.json.auth.user, null)
  } finally {
    srv.close()
    database.close()
  }
})

test('login + session round-trip by username self-identify', async () => {
  const { srv, db } = await authClient()
  try {
    const session = await srv.get('/api/auth/session')
    assert.equal(session.status, 200)
    assert.equal(session.json.user.username, 'alice')

    const logout = await srv.post('/api/auth/logout', {})
    assert.equal(logout.status, 200)
    const after = await srv.get('/api/auth/session')
    assert.equal(after.status, 401)
  } finally {
    srv.close()
    db.close()
  }
})

test('schedules require auth', async () => {
  const db = openDb(':memory:')
  const app = createApp({ database: db, services: ['schedule'] })
  const srv = await startTestServer(app)
  try {
    const res = await srv.get('/api/schedules')
    assert.equal(res.status, 401)
  } finally {
    srv.close()
    db.close()
  }
})

test('create + read a schedule with three empty term parts', async () => {
  const { srv, db } = await authClient()
  try {
    const created = await srv.post('/api/schedules', { name: 'Math proposals', year: '2026-27' })
    assert.equal(created.status, 201)
    const s = created.json.schedule
    assert.equal(s.name, 'Math proposals')
    assert.equal(s.year, '2026-27')
    assert.equal(s.owner, 'alice')
    assert.deepEqual(Object.keys(s.terms).sort(), ['F', 'S', 'W'])
    assert.equal(s.terms.F.offerings.length, 0)

    const got = await srv.get(`/api/schedules/${s.id}`)
    assert.equal(got.status, 200)
    assert.equal(got.json.schedule.id, s.id)
  } finally {
    srv.close()
    db.close()
  }
})

test('owner replaces a term part and version bumps', async () => {
  const { srv, db } = await authClient()
  try {
    const { schedule } = (await srv.post('/api/schedules', { name: 'Math', year: '2026-27' })).json
    const put = await srv.put(`/api/schedules/${schedule.id}/terms/F`, {
      offerings: [{ prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30' }],
    })
    assert.equal(put.status, 200)
    assert.equal(put.json.term.version, 1)
    assert.equal(put.json.term.offerings.length, 1)

    const got = await srv.get(`/api/schedules/${schedule.id}/terms/F`)
    assert.equal(got.json.term.offerings[0].prefix, 'CS')
    assert.equal(got.json.term.version, 1)
  } finally {
    srv.close()
    db.close()
  }
})

test('non-owner cannot modify but can suggest; owner approves against base version', async () => {
  const database = openDb(':memory:')
  const app = createApp({ database, services: ['schedule'] })
  const srv = await startTestServer(app)
  try {
    const alice = srv.newClient()
    const bob = srv.newClient()
    const carol = srv.newClient()
    assert.equal((await alice.post('/api/auth/login', { username: 'alice' })).status, 200)
    assert.equal((await bob.post('/api/auth/login', { username: 'bob' })).status, 200)
    assert.equal((await carol.post('/api/auth/login', { username: 'carol' })).status, 200)

    const { schedule } = (await alice.post('/api/schedules', { name: 'Registrar', year: '2026-27' })).json
    // seed the schedule with a course
    await alice.put(`/api/schedules/${schedule.id}/terms/F`, {
      offerings: [
        { prefix: 'CS', number: '220', section: 'A', days: 'MWF', time: '9:20-10:30', instructor: 'Wahl' },
      ],
    })
    const termF = (await alice.get(`/api/schedules/${schedule.id}/terms/F`)).json.term
    assert.equal(termF.version, 1)

    // A non-owner (bob) trying to write is refused.
    const denied = await bob.put(`/api/schedules/${schedule.id}/terms/F`, { offerings: [] })
    assert.equal(denied.status, 403)

    // Bob proposes a suggestion (change instructor) against version 1.
    const course = {
      prefix: 'CS',
      number: '220',
      section: 'A',
      days: 'MWF',
      time: '9:20-10:30',
      instructor: 'Wahl',
    }
    const sug = await bob.post(`/api/schedules/${schedule.id}/suggestions`, {
      term: 'F',
      baseVersion: 1,
      operations: diffOfferings([course], [{ ...course, instructor: 'Skiadas' }]),
      note: 'change instructor',
    })
    assert.equal(sug.status, 201)

    // Bob (not owner) cannot approve.
    const approveAsBob = await bob.post(`/api/suggestions/${sug.json.suggestion.id}/approve`, {})
    assert.equal(approveAsBob.status, 403)

    // Carol (another non-owner) doesn't see Bob's suggestion.
    const carolView = await carol.get(`/api/schedules/${schedule.id}/suggestions`)
    assert.equal(carolView.json.suggestions.length, 0)

    // Owner sees it and approves.
    const ownerView = await alice.get(`/api/schedules/${schedule.id}/suggestions`)
    assert.equal(ownerView.json.suggestions.length, 1)
    const approved = await alice.post(`/api/suggestions/${sug.json.suggestion.id}/approve`, {})
    assert.equal(approved.status, 200)
    assert.equal(approved.json.term.offerings[0].instructor, 'Skiadas')

    // Version bumped after approval.
    const after = await alice.get(`/api/schedules/${schedule.id}/terms/F`)
    assert.equal(after.json.term.version, 2)
  } finally {
    srv.close()
    database.close()
  }
})

test('approved suggestion with a stale base version is rejected (409)', async () => {
  const { srv, db } = await authClient()
  try {
    const { schedule } = (await srv.post('/api/schedules', { name: 'S', year: '2026-27' })).json
    await srv.put(`/api/schedules/${schedule.id}/terms/F`, {
      offerings: [{ prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30' }],
    })
    const term = (await srv.get(`/api/schedules/${schedule.id}/terms/F`)).json.term
    const sug = await srv.post(`/api/schedules/${schedule.id}/suggestions`, {
      term: 'F',
      baseVersion: term.version,
      operations: [{ kind: 'remove', cur: { prefix: 'CS', number: '101', section: 'A' } }],
    })
    assert.equal(sug.status, 201)

    // Owner edits the term directly (bumps version) before approving -> stale.
    await srv.put(`/api/schedules/${schedule.id}/terms/F`, {
      offerings: [
        { prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30' },
        { prefix: 'BIO', number: '161', section: 'A', days: 'MWF', time: '8:00-9:10' },
      ],
    })
    const approve = await srv.post(`/api/suggestions/${sug.json.suggestion.id}/approve`, {})
    assert.equal(approve.status, 409)
  } finally {
    srv.close()
    db.close()
  }
})

test('suggestions export as md and csv', async () => {
  const { srv, db } = await authClient()
  try {
    const { schedule } = (await srv.post('/api/schedules', { name: 'Export', year: '2026-27' })).json
    await srv.put(`/api/schedules/${schedule.id}/terms/F`, {
      offerings: [
        { prefix: 'CS', number: '220', section: 'A', days: 'MWF', time: '9:20-10:30', instructor: 'Wahl' },
      ],
    })
    const term = (await srv.get(`/api/schedules/${schedule.id}/terms/F`)).json.term
    const course = {
      prefix: 'CS',
      number: '220',
      section: 'A',
      days: 'MWF',
      time: '9:20-10:30',
      instructor: 'Wahl',
    }
    await srv.post(`/api/schedules/${schedule.id}/suggestions`, {
      term: 'F',
      baseVersion: term.version,
      operations: diffOfferings([course], [{ ...course, instructor: 'Skiadas' }]),
    })
    const md = await srv.get(`/api/schedules/${schedule.id}/suggestions/export?fmt=md`)
    assert.equal(md.status, 200)
    assert.match(md.text, /instructor from Wahl to Skiadas/)
    const csv = await srv.get(`/api/schedules/${schedule.id}/suggestions/export?fmt=csv`)
    assert.equal(csv.status, 200)
    assert.match(csv.text, /CS 220/)
  } finally {
    srv.close()
    db.close()
  }
})

test('rename and mark official by owner', async () => {
  const { srv, db } = await authClient()
  try {
    const { schedule } = (await srv.post('/api/schedules', { name: 'Draft', year: '2026-27' })).json
    const patched = await srv.patch(`/api/schedules/${schedule.id}`, {
      name: 'Official Draft',
      status: 'official',
    })
    assert.equal(patched.status, 200)
    assert.equal(patched.json.schedule.name, 'Official Draft')
    assert.equal(patched.json.schedule.status, 'official')
  } finally {
    srv.close()
    db.close()
  }
})
