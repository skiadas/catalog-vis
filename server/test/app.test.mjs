import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.js'
import { createApp } from '../src/app.js'
import { startTestServer } from './helpers.mjs'
import { diffOfferings } from '@major-vis/schedule-core/diff'

// A self-contained client: fresh in-memory DB + server + a logged-in username.
async function authClient(username = 'alice') {
  const database = await openDb(':memory:')
  const app = createApp({ database, services: ['schedule'] })
  const srv = await startTestServer(app)
  const login = await srv.post('/api/auth/login', { username })
  assert.equal(login.status, 200)
  return { srv, db: database }
}

test('config reports enabled services and anonymous auth', async () => {
  const database = await openDb(':memory:')
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
    // No session reports user:null (data, not a 401) — the schedule app boots
    // with this check before any sign-in.
    assert.equal(after.status, 200)
    assert.equal(after.json.user, null)
  } finally {
    srv.close()
    db.close()
  }
})

test('schedules require auth', async () => {
  const db = await openDb(':memory:')
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

test('non-owner cannot modify but can suggest; others see pending; owner approves', async () => {
  const database = await openDb(':memory:')
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
    const approveAsBob = await bob.post(`/api/suggestions/${sug.json.suggestion.id}/approve`, {
      opId: sug.json.suggestion.operations[0].id,
    })
    assert.equal(approveAsBob.status, 403)

    // Carol (another non-owner) DOES see Bob's pending suggestion.
    const carolView = await carol.get(`/api/schedules/${schedule.id}/suggestions`)
    assert.equal(carolView.json.suggestions.length, 1)
    assert.equal(carolView.json.suggestions[0].proposer, 'bob')

    // Owner sees it and approves; the response names the status.
    const ownerView = await alice.get(`/api/schedules/${schedule.id}/suggestions`)
    assert.equal(ownerView.json.suggestions.length, 1)
    const approved = await alice.post(`/api/suggestions/${sug.json.suggestion.id}/approve`, {
      opId: sug.json.suggestion.operations[0].id,
    })
    assert.equal(approved.status, 200)
    assert.equal(approved.json.suggestion.status, 'approved')
    assert.equal(approved.json.term.offerings[0].instructor, 'Skiadas')

    // Version bumped after approval.
    const after = await alice.get(`/api/schedules/${schedule.id}/terms/F`)
    assert.equal(after.json.term.version, 2)

    // Carol no longer sees it as pending (it is now history she didn't write).
    const carolAfter = await carol.get(`/api/schedules/${schedule.id}/suggestions`)
    assert.equal(carolAfter.json.suggestions.length, 0)

    // Carol still sees her own resolved history when she has some.
    const carolSug = await carol.post(`/api/schedules/${schedule.id}/suggestions`, {
      term: 'F',
      baseVersion: 2,
      operations: [{ kind: 'remove', cur: { prefix: 'CS', number: '220', section: 'A' } }],
    })
    await alice.post(`/api/suggestions/${carolSug.json.suggestion.id}/reject`, {
      opId: carolSug.json.suggestion.operations[0].id,
    })
    const carolOwn = await carol.get(`/api/schedules/${schedule.id}/suggestions`)
    assert.equal(carolOwn.json.suggestions.length, 1)
    assert.equal(carolOwn.json.suggestions[0].proposer, 'carol')
    assert.equal(carolOwn.json.suggestions[0].status, 'rejected')
  } finally {
    srv.close()
    database.close()
  }
})

test('concurrent suggestions from many proposers approve independently, in any order', async () => {
  const database = await openDb(':memory:')
  const app = createApp({ database, services: ['schedule'] })
  const srv = await startTestServer(app)
  try {
    const alice = srv.newClient()
    const physics = srv.newClient()
    const math = srv.newClient()
    assert.equal((await alice.post('/api/auth/login', { username: 'alice' })).status, 200)
    assert.equal((await physics.post('/api/auth/login', { username: 'physics' })).status, 200)
    assert.equal((await math.post('/api/auth/login', { username: 'math' })).status, 200)
    const { schedule } = (await alice.post('/api/schedules', { name: 'Registrar', year: '2026-27' })).json
    await alice.put(`/api/schedules/${schedule.id}/terms/F`, {
      offerings: [
        { prefix: 'PHY', number: '121', section: 'A', days: 'MWF', time: '9:20-10:30' },
        { prefix: 'MAT', number: '131', section: 'A', days: 'TR', time: '10:00-11:45' },
      ],
    })
    const term = (await alice.get(`/api/schedules/${schedule.id}/terms/F`)).json.term
    const base = term.version

    // Physics proposes moving PHY 121; Math proposes moving MAT 131, both
    // against the same base version.
    const phy = (
      await physics.post(`/api/schedules/${schedule.id}/suggestions`, {
        term: 'F',
        baseVersion: base,
        operations: diffOfferings(
          [{ prefix: 'PHY', number: '121', section: 'A', days: 'MWF', time: '9:20-10:30' }],
          [{ prefix: 'PHY', number: '121', section: 'A', days: 'MWF', time: '12:00-13:10' }],
        ),
      })
    ).json.suggestion
    const mat = (
      await math.post(`/api/schedules/${schedule.id}/suggestions`, {
        term: 'F',
        baseVersion: base,
        operations: diffOfferings(
          [{ prefix: 'MAT', number: '131', section: 'A', days: 'TR', time: '10:00-11:45' }],
          [{ prefix: 'MAT', number: '131', section: 'A', days: 'TR', time: '14:15-16:00' }],
        ),
      })
    ).json.suggestion

    // Math's proposal is still live after Physics' is approved (no invalidation).
    const mathOk = await alice.post(`/api/suggestions/${mat.id}/approve`, { opId: mat.operations[0].id })
    assert.equal(mathOk.status, 200)
    const physOk = await alice.post(`/api/suggestions/${phy.id}/approve`, { opId: phy.operations[0].id })
    assert.equal(physOk.status, 200)

    const after = (await alice.get(`/api/schedules/${schedule.id}/terms/F`)).json.term
    const find = (code) => after.offerings.find((o) => `${o.prefix} ${o.number}` === code)
    assert.equal(find('PHY 121').time, '12:00-13:10')
    assert.equal(find('MAT 131').time, '14:15-16:00')

    // The paper trail shows both, each with its proposer.
    const history = (await alice.get(`/api/schedules/${schedule.id}/suggestions`)).json.suggestions
    assert.equal(history.length, 2)
    assert.equal(
      history.every((c) => c.status === 'approved'),
      true,
    )
    assert.deepEqual(history.map((c) => c.proposer).sort(), ['math', 'physics'])
  } finally {
    srv.close()
    database.close()
  }
})

test('proposer can edit, then withdraw, their own pending suggestion; moot on no-op approve', async () => {
  const { srv, db } = await authClient()
  try {
    const { schedule } = (await srv.post('/api/schedules', { name: 'S', year: '2026-27' })).json
    await srv.put(`/api/schedules/${schedule.id}/terms/F`, {
      offerings: [{ prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30' }],
    })
    const term = (await srv.get(`/api/schedules/${schedule.id}/terms/F`)).json.term
    const sug = (
      await srv.post(`/api/schedules/${schedule.id}/suggestions`, {
        term: 'F',
        baseVersion: term.version,
        operations: [{ kind: 'remove', cur: { prefix: 'CS', number: '101', section: 'A' } }],
      })
    ).json.suggestion

    // Someone else cannot edit or withdraw it.
    const other = srv.newClient()
    await other.post('/api/auth/login', { username: 'bob' })
    assert.equal((await other.patch(`/api/suggestions/${sug.id}`, { note: 'hijack' })).status, 403)
    assert.equal((await other.post(`/api/suggestions/${sug.id}/withdraw`, {})).status, 403)

    // The proposer replaces the operations (a stale state, but a valid one: the
    // term changed under the proposal) and updates the note.
    const edited = await srv.patch(`/api/suggestions/${sug.id}`, {
      operations: [
        {
          kind: 'update',
          cur: { prefix: 'CS', number: '101', section: 'A' },
          changes: { time: '8:00-9:10' },
          diff: [],
        },
      ],
      note: 'reconsidered: just move the time',
    })
    assert.equal(edited.status, 200)
    assert.equal(edited.json.suggestion.note, 'reconsidered: just move the time')
    assert.equal(edited.json.suggestion.operations[0].op.kind, 'update')
    assert.equal(edited.json.suggestion.operations[0].resolution.status, 'pending')

    // The owner deletes the course directly (the term moved on), so approving
    // the suggestion changes nothing -> moot.
    await srv.put(`/api/schedules/${schedule.id}/terms/F`, { offerings: [] })
    const approve = await srv.post(`/api/suggestions/${sug.id}/approve`, {
      opId: edited.json.suggestion.operations[0].id,
    })
    assert.equal(approve.status, 200)
    assert.equal(approve.json.suggestion.status, 'moot')
    const termAfter = (await srv.get(`/api/schedules/${schedule.id}/terms/F`)).json.term
    assert.equal(termAfter.offerings.length, 0)

    // A second pending suggestion can be withdrawn (soft) and stays in the trail.
    const second = (
      await srv.post(`/api/schedules/${schedule.id}/suggestions`, {
        term: 'F',
        baseVersion: termAfter.version,
        operations: [
          {
            kind: 'add',
            offering: { prefix: 'BIO', number: '161', section: 'A', days: 'MWF', time: '8:00-9:10' },
          },
        ],
      })
    ).json.suggestion
    const withdrawn = await srv.post(`/api/suggestions/${second.id}/withdraw`, {})
    assert.equal(withdrawn.status, 200)
    assert.equal(withdrawn.json.suggestion.status, 'withdrawn')
    assert.equal(withdrawn.json.suggestion.operations[0].resolution.status, 'withdrawn')
    // Withdrawing an already-withdrawn (no longer pending) proposal is refused.
    assert.equal((await srv.post(`/api/suggestions/${second.id}/withdraw`, {})).status, 409)
    const trail = (await srv.get(`/api/schedules/${schedule.id}/suggestions`)).json.suggestions
    assert.equal(trail.length, 2)
    assert.deepEqual(trail.map((c) => c.status).sort(), ['moot', 'withdrawn'])
  } finally {
    srv.close()
    db.close()
  }
})

test('one suggestion, per-op resolution: partial approve stays pending, review locks edits, all-resolved finalizes', async () => {
  const { srv, db } = await authClient()
  try {
    const { schedule } = (await srv.post('/api/schedules', { name: 'Partial', year: '2026-27' })).json
    await srv.put(`/api/schedules/${schedule.id}/terms/F`, {
      offerings: [
        { prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30', instructor: 'Wahl' },
        { prefix: 'MAT', number: '131', section: 'A', days: 'TR', time: '10:00-11:45', instructor: 'Adams' },
      ],
    })
    const term = (await srv.get(`/api/schedules/${schedule.id}/terms/F`)).json.term
    const sug = (
      await srv.post(`/api/schedules/${schedule.id}/suggestions`, {
        term: 'F',
        baseVersion: term.version,
        operations: [
          {
            kind: 'update',
            cur: { prefix: 'CS', number: '101', section: 'A' },
            changes: { instructor: 'Novak' },
            diff: [],
          },
          {
            kind: 'update',
            cur: { prefix: 'MAT', number: '131', section: 'A' },
            changes: { time: '14:15-16:00' },
            diff: [],
          },
        ],
      })
    ).json.suggestion
    assert.ok(sug.operations.every((o) => o.resolution.status === 'pending'))
    assert.ok(sug.operations.every((o) => Number.isInteger(o.id)))
    const [csOp, matOp] = sug.operations

    // Missing/unknown op ids are refused.
    assert.equal((await srv.post(`/api/suggestions/${sug.id}/approve`, {})).status, 400)
    assert.equal((await srv.post(`/api/suggestions/${sug.id}/approve`, { opId: 9999 })).status, 400)
    assert.equal((await srv.post(`/api/suggestions/${sug.id}/reject`, { opId: 'nope' })).status, 400)

    // Approving one op changes only that part of the term; the row stays live.
    const first = await srv.post(`/api/suggestions/${sug.id}/approve`, { opId: csOp.id })
    assert.equal(first.status, 200)
    assert.equal(first.json.suggestion.status, 'pending')
    assert.equal(first.json.suggestion.operations[0].resolution.status, 'accepted')
    assert.ok(first.json.suggestion.operations[0].resolution.applied === true)
    assert.equal(first.json.suggestion.operations[1].resolution.status, 'pending')
    assert.equal(first.json.term.offerings.find((o) => o.prefix === 'CS').instructor, 'Novak')
    assert.equal(first.json.term.offerings.find((o) => o.prefix === 'MAT').time, '10:00-11:45')

    // Reviewing locks the proposer out of editing (here proposer == owner, so
    // the only guard left is the in_review one)...
    const edit = await srv.patch(`/api/suggestions/${sug.id}`, { note: 'shh' })
    assert.equal(edit.status, 409)
    assert.equal(edit.json.error, 'in_review')

    // ...and re-resolving an already-resolved op is refused.
    assert.equal((await srv.post(`/api/suggestions/${sug.id}/approve`, { opId: csOp.id })).status, 409)

    // The proposer can still withdraw the remaining pending op; the row now has
    // one applied accepted change and one withdrawn -> derived 'approved'.
    const pulled = await srv.post(`/api/suggestions/${sug.id}/withdraw`, { opId: matOp.id })
    assert.equal(pulled.status, 200)
    assert.equal(pulled.json.suggestion.status, 'approved')
    assert.equal(pulled.json.suggestion.operations[0].resolution.status, 'accepted')
    assert.equal(pulled.json.suggestion.operations[1].resolution.status, 'withdrawn')
    assert.ok(pulled.json.suggestion.resolved_at)

    // Proposal-level state is fully decided: any further action is refused.
    assert.equal((await srv.post(`/api/suggestions/${sug.id}/reject`, { opId: matOp.id })).status, 409)
    assert.equal((await srv.post(`/api/suggestions/${sug.id}/withdraw`, {})).status, 409)
    assert.equal((await srv.patch(`/api/suggestions/${sug.id}`, { note: 'late' })).status, 409)
  } finally {
    srv.close()
    db.close()
  }
})

test('per-op withdraw by a separate proposer: rejected+withdrawn derives withdrawn; withdraw-all; edits after outline ops stay allowed', async () => {
  const database = await openDb(':memory:')
  const app = createApp({ database, services: ['schedule'] })
  const srv = await startTestServer(app)
  try {
    const registrar = srv.newClient()
    const math = srv.newClient()
    assert.equal((await registrar.post('/api/auth/login', { username: 'registrar' })).status, 200)
    assert.equal((await math.post('/api/auth/login', { username: 'math' })).status, 200)
    const { schedule } = (await registrar.post('/api/schedules', { name: 'Withdraw', year: '2026-27' })).json
    await registrar.put(`/api/schedules/${schedule.id}/terms/F`, {
      offerings: [
        { prefix: 'MAT', number: '131', section: 'A', days: 'TR', time: '10:00-11:45' },
        { prefix: 'PHY', number: '121', section: 'A', days: 'MWF', time: '9:20-10:30' },
      ],
    })
    const term = (await registrar.get(`/api/schedules/${schedule.id}/terms/F`)).json.term

    const propose = (ops) =>
      math.post(`/api/schedules/${schedule.id}/suggestions`, {
        term: 'F',
        baseVersion: term.version,
        operations: ops,
      })

    // Math proposes two moves. The registrar rejects one; math withdraws the
    // other -> the suggestion derives 'withdrawn' (never applied, and the
    // withdrawn status outranks rejected in the summary).
    const mixed = (
      await propose([
        {
          kind: 'update',
          cur: { prefix: 'MAT', number: '131', section: 'A' },
          changes: { time: '14:15-16:00' },
          diff: [],
        },
        {
          kind: 'update',
          cur: { prefix: 'PHY', number: '121', section: 'A' },
          changes: { time: '12:00-13:10' },
          diff: [],
        },
      ])
    ).json.suggestion
    const [matOp, phyOp] = mixed.operations
    assert.equal(
      (await registrar.post(`/api/suggestions/${mixed.id}/reject`, { opId: matOp.id })).status,
      200,
    )
    const pulled = await math.post(`/api/suggestions/${mixed.id}/withdraw`, { opId: phyOp.id })
    assert.equal(pulled.status, 200)
    assert.equal(pulled.json.suggestion.status, 'withdrawn')
    assert.deepEqual(
      pulled.json.suggestion.operations.map((e) => e.resolution.status),
      ['rejected', 'withdrawn'],
    )
    // The term was never touched.
    assert.equal((await registrar.get(`/api/schedules/${schedule.id}/terms/F`)).json.term.offerings.length, 2)

    // A second proposal, withdrawn wholesale: all ops become 'withdrawn'.
    const second = (
      await propose([
        {
          kind: 'update',
          cur: { prefix: 'MAT', number: '131', section: 'A' },
          changes: { time: '14:15-16:00' },
          diff: [],
        },
      ])
    ).json.suggestion
    const gone = await math.post(`/api/suggestions/${second.id}/withdraw`, {})
    assert.equal(gone.status, 200)
    assert.equal(gone.json.suggestion.status, 'withdrawn')
    assert.equal(gone.json.suggestion.operations[0].resolution.status, 'withdrawn')

    // A third proposal: math withdraws one op while another is still pending (and
    // the owner made no decision). The row stays live ('pending'), and the op
    // replacement edit is still allowed — the outline op is dropped and the list
    // restarts pending.
    const third = (
      await propose([
        {
          kind: 'update',
          cur: { prefix: 'MAT', number: '131', section: 'A' },
          changes: { time: '14:15-16:00' },
          diff: [],
        },
        {
          kind: 'update',
          cur: { prefix: 'PHY', number: '121', section: 'A' },
          changes: { time: '12:00-13:10' },
          diff: [],
        },
      ])
    ).json.suggestion
    const partialPull = await math.post(`/api/suggestions/${third.id}/withdraw`, {
      opId: third.operations[0].id,
    })
    assert.equal(partialPull.status, 200)
    assert.equal(partialPull.json.suggestion.status, 'pending')
    const revised = await math.patch(`/api/suggestions/${third.id}`, {
      operations: [
        {
          kind: 'update',
          cur: { prefix: 'MAT', number: '131', section: 'A' },
          changes: { time: '14:15-16:00' },
          diff: [],
        },
      ],
    })
    assert.equal(revised.status, 200)
    assert.equal(revised.json.suggestion.operations.length, 1)
    assert.deepEqual(
      revised.json.suggestion.operations.map((e) => e.resolution.status),
      ['pending'],
    )

    // An already-finalized row refuses a late edit.
    const late = await math.patch(`/api/suggestions/${mixed.id}`, { note: 'late' })
    assert.equal(late.status, 409)
    assert.equal(late.json.error, 'not_pending')
  } finally {
    srv.close()
    database.close()
  }
})

test('schedules list carries full term payloads', async () => {
  const { srv, db } = await authClient()
  try {
    const { schedule } = (await srv.post('/api/schedules', { name: 'List', year: '2026-27' })).json
    await srv.put(`/api/schedules/${schedule.id}/terms/F`, {
      offerings: [{ prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30' }],
    })
    const list = (await srv.get('/api/schedules')).json.schedules
    assert.equal(list.length, 1)
    assert.deepEqual(list[0].terms.F.offerings, [
      { prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30' },
    ])
    assert.equal(list[0].terms.F.version, 1)
    assert.deepEqual(list[0].terms.W.offerings, [])
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
