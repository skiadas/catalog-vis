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
  const app = createApp({ database, services: ['schedule'], adminUsernames: new Set(['alice']) })
  const srv = await startTestServer(app)
  try {
    const alice = srv.newClient()
    const bob = srv.newClient()
    const carol = srv.newClient()
    assert.equal((await alice.post('/api/auth/login', { username: 'alice' })).status, 200)
    assert.equal((await bob.post('/api/auth/login', { username: 'bob' })).status, 200)
    assert.equal((await carol.post('/api/auth/login', { username: 'carol' })).status, 200)
    // Non-owner proposals are dept-scoped; the fixture's courses are CS.
    assert.equal((await alice.post('/api/admin/users', { username: 'bob', departments: ['CS'] })).status, 201)
    assert.equal(
      (await alice.post('/api/admin/users', { username: 'carol', departments: ['CS'] })).status,
      201,
    )

    const { schedule } = (await alice.post('/api/schedules', { name: 'Registrar', year: '2026-27' })).json
    // Schedules are private by default; this flow is about suggestion
    // mechanics, so the owner opens the schedule up to everyone.
    const opened = await alice.patch(`/api/schedules/${schedule.id}`, {
      visibility: 'public',
      suggestMode: 'public',
    })
    assert.equal(opened.status, 200)
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
  const app = createApp({ database, services: ['schedule'], adminUsernames: new Set(['alice']) })
  const srv = await startTestServer(app)
  try {
    const alice = srv.newClient()
    const physics = srv.newClient()
    const math = srv.newClient()
    assert.equal((await alice.post('/api/auth/login', { username: 'alice' })).status, 200)
    assert.equal((await physics.post('/api/auth/login', { username: 'physics' })).status, 200)
    assert.equal((await math.post('/api/auth/login', { username: 'math' })).status, 200)
    assert.equal(
      (await alice.post('/api/admin/users', { username: 'physics', departments: ['PHY'] })).status,
      201,
    )
    assert.equal(
      (await alice.post('/api/admin/users', { username: 'math', departments: ['MAT'] })).status,
      201,
    )
    const { schedule } = (await alice.post('/api/schedules', { name: 'Registrar', year: '2026-27' })).json
    // Private by default: open the schedule so the two departments can propose.
    await alice.patch(`/api/schedules/${schedule.id}`, { visibility: 'public', suggestMode: 'public' })
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
  const app = createApp({ database, services: ['schedule'], adminUsernames: new Set(['registrar']) })
  const srv = await startTestServer(app)
  try {
    const registrar = srv.newClient()
    const math = srv.newClient()
    assert.equal((await registrar.post('/api/auth/login', { username: 'registrar' })).status, 200)
    assert.equal((await math.post('/api/auth/login', { username: 'math' })).status, 200)
    assert.equal(
      (
        await registrar.post('/api/admin/users', {
          username: 'math',
          departments: ['MAT', 'PHY'],
        })
      ).status,
      201,
    )
    const { schedule } = (await registrar.post('/api/schedules', { name: 'Withdraw', year: '2026-27' })).json
    // Private by default: open the schedule so math can propose against it.
    await registrar.patch(`/api/schedules/${schedule.id}`, { visibility: 'public', suggestMode: 'public' })
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
    const offering = list[0].terms.F.offerings[0]
    assert.deepEqual(
      {
        prefix: offering.prefix,
        number: offering.number,
        section: offering.section,
        days: offering.days,
        time: offering.time,
      },
      { prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '9:20-10:30' },
    )
    assert.ok(offering.id, 'the server fills the content id for split-meeting rows')
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

test('suggestion ops carrying secondaryInstructors apply and describe', async () => {
  const { srv, db } = await authClient()
  try {
    const { schedule } = (await srv.post('/api/schedules', { name: 'Team', year: '2026-27' })).json
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
      secondaryInstructors: [],
    }
    const sug = (
      await srv.post(`/api/schedules/${schedule.id}/suggestions`, {
        term: 'F',
        baseVersion: term.version,
        operations: diffOfferings([course], [{ ...course, secondaryInstructors: ['Xu', 'Ray'] }]),
        note: 'add team teachers',
      })
    ).json.suggestion

    // The proposed op flows through storage and reads naturally as "other
    // instructors".
    const md = await srv.get(`/api/schedules/${schedule.id}/suggestions/export?fmt=md`)
    assert.equal(md.status, 200)
    assert.match(md.text, /other instructors set to Xu, Ray/)

    // Approving writes the array into the published term.
    const approved = await srv.post(`/api/suggestions/${sug.id}/approve`, {
      opId: sug.operations[0].id,
    })
    assert.equal(approved.status, 200)
    assert.deepEqual(approved.json.term.offerings[0].secondaryInstructors, ['Xu', 'Ray'])
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

// ---- Access control (visibility + suggesters) ---------------------------

// Creates alice's schedule with a seeded course and returns { srv, alice, bob,
// carol, schedule, term } with everyone signed in.
async function accessFixture() {
  const database = await openDb(':memory:')
  const app = createApp({ database, services: ['schedule'], adminUsernames: new Set(['alice']) })
  const srv = await startTestServer(app)
  const alice = srv.newClient()
  const bob = srv.newClient()
  const carol = srv.newClient()
  assert.equal((await alice.post('/api/auth/login', { username: 'alice' })).status, 200)
  assert.equal((await bob.post('/api/auth/login', { username: 'bob' })).status, 200)
  assert.equal((await carol.post('/api/auth/login', { username: 'carol' })).status, 200)
  const { schedule } = (await alice.post('/api/schedules', { name: 'Access', year: '2026-27' })).json
  await alice.put(`/api/schedules/${schedule.id}/terms/F`, {
    offerings: [{ prefix: 'CS', number: '220', section: 'A', days: 'MWF', time: '9:20-10:30' }],
  })
  const term = (await alice.get(`/api/schedules/${schedule.id}/terms/F`)).json.term
  return { srv, db: database, alice, bob, carol, schedule, term }
}

test('new schedules are private by default: owner-only list, 404s for others', async () => {
  const { srv, db, alice, bob, schedule } = await accessFixture()
  try {
    // The schedule row advertises the defaults.
    const row = (await alice.get(`/api/schedules/${schedule.id}`)).json.schedule
    assert.equal(row.visibility, 'private')
    assert.equal(row.suggestMode, 'owner')
    assert.deepEqual(row.viewers, [])
    assert.deepEqual(row.suggesters, [])

    // Alice sees her own schedule; bob sees nothing.
    assert.equal((await alice.get('/api/schedules')).json.schedules.length, 1)
    assert.deepEqual((await bob.get('/api/schedules')).json.schedules, [])

    // Bob cannot read the schedule, its terms, suggestions, or export — 404
    // everywhere, so its existence is never leaked.
    assert.equal((await bob.get(`/api/schedules/${schedule.id}`)).status, 404)
    assert.equal((await bob.get(`/api/schedules/${schedule.id}/terms/F`)).status, 404)
    assert.equal((await bob.get(`/api/schedules/${schedule.id}/suggestions`)).status, 404)
    assert.equal((await bob.get(`/api/schedules/${schedule.id}/suggestions/export?fmt=md`)).status, 404)

    // Bob cannot propose either (same 404, not a 403).
    const sug = await bob.post(`/api/schedules/${schedule.id}/suggestions`, {
      term: 'F',
      baseVersion: 1,
      operations: [{ kind: 'remove', cur: { prefix: 'CS', number: '220', section: 'A' } }],
    })
    assert.equal(sug.status, 404)
  } finally {
    srv.close()
    db.close()
  }
})

test('shared visibility admits listed viewers only; suggestion POST is gated separately', async () => {
  const { srv, db, alice, bob, carol, schedule, term } = await accessFixture()
  try {
    // Bob is a listed viewer; carol is not. Suggesting stays owner-only.
    const patched = await alice.patch(`/api/schedules/${schedule.id}`, {
      visibility: 'shared',
      viewers: ['Bob', 'bob@hanover.edu'],
      suggesters: [],
    })
    assert.equal(patched.status, 200)
    // List entries are canonicalized (trimmed, lowercased, deduped).
    assert.deepEqual(patched.json.schedule.viewers, ['bob', 'bob@hanover.edu'])

    // Bob sees the schedule in the list and can read it.
    assert.equal((await bob.get('/api/schedules')).json.schedules.length, 1)
    assert.equal((await bob.get(`/api/schedules/${schedule.id}`)).status, 200)
    assert.equal((await bob.get(`/api/schedules/${schedule.id}/terms/F`)).json.term.version, term.version)

    // Carol still gets 404s.
    assert.equal((await carol.get(`/api/schedules/${schedule.id}`)).status, 404)
    assert.deepEqual((await carol.get('/api/schedules')).json.schedules, [])

    // A viewer who may not suggest gets a clear 403 on proposal.
    const denied = await bob.post(`/api/schedules/${schedule.id}/suggestions`, {
      term: 'F',
      baseVersion: term.version,
      operations: [{ kind: 'remove', cur: { prefix: 'CS', number: '220', section: 'A' } }],
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.json.error, 'not_suggester')
  } finally {
    srv.close()
    db.close()
  }
})

test('listed suggesters can view and propose even when visibility stays private', async () => {
  const { srv, db, alice, bob, carol, schedule, term } = await accessFixture()
  try {
    // Bob's proposals are dept-scoped to CS (the fixture's course).
    assert.equal((await alice.post('/api/admin/users', { username: 'bob', departments: ['CS'] })).status, 201)
    // suggest_mode=shared with bob listed; visibility stays private.
    await alice.patch(`/api/schedules/${schedule.id}`, {
      suggestMode: 'shared',
      suggesters: ['bob'],
    })

    // Bob (a suggester) can view the schedule despite its private visibility…
    assert.equal((await bob.get(`/api/schedules/${schedule.id}`)).status, 200)
    assert.equal((await bob.get(`/api/schedules/${schedule.id}/terms/F`)).status, 200)
    assert.equal((await bob.get(`/api/schedules/${schedule.id}/suggestions`)).status, 200)
    // …and propose.
    const sug = await bob.post(`/api/schedules/${schedule.id}/suggestions`, {
      term: 'F',
      baseVersion: term.version,
      operations: [
        {
          kind: 'update',
          cur: { prefix: 'CS', number: '220', section: 'A' },
          changes: { instructor: 'Skiadas' },
          diff: [],
        },
      ],
    })
    assert.equal(sug.status, 201)

    // Carol is neither viewer nor suggester: still fully hidden.
    assert.equal((await carol.get(`/api/schedules/${schedule.id}`)).status, 404)
    assert.equal((await carol.get('/api/schedules')).json.schedules.length, 0)
  } finally {
    srv.close()
    db.close()
  }
})

test('public visibility + suggest_mode open the schedule to every signed-in user', async () => {
  const { srv, db, alice, carol, schedule, term } = await accessFixture()
  try {
    await alice.patch(`/api/schedules/${schedule.id}`, { visibility: 'public', suggestMode: 'public' })
    // Carol's proposal is dept-scoped to CS (the fixture's course).
    assert.equal(
      (await alice.post('/api/admin/users', { username: 'carol', departments: ['CS'] })).status,
      201,
    )

    // Carol sees it in the list and can read + propose.
    assert.equal((await carol.get('/api/schedules')).json.schedules.length, 1)
    assert.equal((await carol.get(`/api/schedules/${schedule.id}/terms/F`)).status, 200)
    const sug = await carol.post(`/api/schedules/${schedule.id}/suggestions`, {
      term: 'F',
      baseVersion: term.version,
      operations: [{ kind: 'remove', cur: { prefix: 'CS', number: '220', section: 'A' } }],
    })
    assert.equal(sug.status, 201)

    // …but she cannot write terms directly (ownership is unchanged).
    assert.equal((await carol.put(`/api/schedules/${schedule.id}/terms/F`, { offerings: [] })).status, 403)
  } finally {
    srv.close()
    db.close()
  }
})

test('access fields are owner-only and validated', async () => {
  const { srv, db, alice, bob, schedule } = await accessFixture()
  try {
    // Non-owner cannot touch access fields.
    assert.equal((await bob.patch(`/api/schedules/${schedule.id}`, { visibility: 'public' })).status, 403)

    // Bad enums and bad lists are refused.
    assert.equal((await alice.patch(`/api/schedules/${schedule.id}`, { visibility: 'nope' })).status, 400)
    assert.equal((await alice.patch(`/api/schedules/${schedule.id}`, { suggestMode: 'nope' })).status, 400)
    assert.equal((await alice.patch(`/api/schedules/${schedule.id}`, { viewers: 'bob' })).status, 400)
    assert.equal((await alice.patch(`/api/schedules/${schedule.id}`, { suggesters: [''] })).status, 400)
    assert.equal(
      (await alice.patch(`/api/schedules/${schedule.id}`, { suggesters: ['x'.repeat(121)] })).status,
      400,
    )

    // Mixed update: name/status and access fields together work.
    const patched = await alice.patch(`/api/schedules/${schedule.id}`, {
      name: 'Open',
      status: 'official',
      visibility: 'shared',
      suggestMode: 'shared',
      viewers: ['bob'],
      suggesters: ['bob', 'BOB'],
    })
    assert.equal(patched.status, 200)
    assert.equal(patched.json.schedule.name, 'Open')
    assert.equal(patched.json.schedule.status, 'official')
    assert.equal(patched.json.schedule.visibility, 'shared')
    assert.equal(patched.json.schedule.suggestMode, 'shared')
    assert.deepEqual(patched.json.schedule.viewers, ['bob'])
    assert.deepEqual(patched.json.schedule.suggesters, ['bob'])

    // A partial access update leaves the other fields untouched.
    const partial = await alice.patch(`/api/schedules/${schedule.id}`, { suggesters: ['carol'] })
    assert.equal(partial.status, 200)
    assert.equal(partial.json.schedule.visibility, 'shared')
    assert.deepEqual(partial.json.schedule.viewers, ['bob'])
    assert.deepEqual(partial.json.schedule.suggesters, ['carol'])
  } finally {
    srv.close()
    db.close()
  }
})

// ---- Username canonicalization (AUTH_DOMAIN) ----------------------------

test('login canonicalizes bare usernames when a default domain is configured', async () => {
  const database = await openDb(':memory:')
  const app = createApp({
    database,
    services: ['schedule'],
    authDomain: 'hanover.edu',
  })
  const srv = await startTestServer(app)
  try {
    // Bare and full forms resolve to the same account (lowercased).
    const a = await srv.post('/api/auth/login', { username: 'CSkiadas' })
    assert.equal(a.status, 200)
    assert.equal(a.json.user.username, 'cskiadas@hanover.edu')
    const b = await srv.post('/api/auth/login', { username: 'cskiadas@hanover.edu' })
    assert.equal(b.status, 200)
    assert.equal(b.json.user.username, 'cskiadas@hanover.edu')
    const users = database.prepare('SELECT COUNT(*) AS n FROM users').get()
    assert.equal(users.n, 1, 'one account for both spellings')

    // An explicit different domain stays as typed.
    const c = await srv.post('/api/auth/login', { username: 'wahl@elsewhere.org' })
    assert.equal(c.status, 200)
    assert.equal(c.json.user.username, 'wahl@elsewhere.org')

    // Blank input is still refused.
    assert.equal((await srv.post('/api/auth/login', { username: '  ' })).status, 400)
  } finally {
    srv.close()
    database.close()
  }
})

test('access lists canonicalize bare usernames with a default domain', async () => {
  const database = await openDb(':memory:')
  const app = createApp({
    database,
    services: ['schedule'],
    authDomain: 'hanover.edu',
  })
  const srv = await startTestServer(app)
  try {
    const alice = srv.newClient()
    const bob = srv.newClient()
    assert.equal((await alice.post('/api/auth/login', { username: 'alice' })).status, 200)
    // Bob signs in with the full address the domain default produces.
    assert.equal((await bob.post('/api/auth/login', { username: 'bob@hanover.edu' })).status, 200)
    const { schedule } = (await alice.post('/api/schedules', { name: 'Canon' })).json

    // "bob" in the list canonicalizes to bob@hanover.edu, which matches the
    // signed-in identity.
    const patched = await alice.patch(`/api/schedules/${schedule.id}`, {
      visibility: 'shared',
      suggestMode: 'shared',
      viewers: ['bob'],
      suggesters: ['BOB'],
    })
    assert.equal(patched.status, 200)
    assert.deepEqual(patched.json.schedule.viewers, ['bob@hanover.edu'])
    assert.deepEqual(patched.json.schedule.suggesters, ['bob@hanover.edu'])

    // Bob therefore sees the schedule and can propose.
    assert.equal((await bob.get(`/api/schedules/${schedule.id}`)).status, 200)
  } finally {
    srv.close()
    database.close()
  }
})

// ---- Admin user directory + autocomplete --------------------------------

test('admins manage the user directory; non-admins are refused', async () => {
  const database = await openDb(':memory:')
  const app = createApp({
    database,
    services: ['schedule'],
    adminUsernames: new Set(['alice']),
  })
  const srv = await startTestServer(app)
  try {
    const alice = srv.newClient()
    const bob = srv.newClient()
    assert.equal((await alice.post('/api/auth/login', { username: 'alice' })).status, 200)
    assert.equal((await bob.post('/api/auth/login', { username: 'bob' })).status, 200)

    // The identity contract advertises the admin flag.
    const session = await alice.get('/api/auth/session')
    assert.equal(session.json.user.username, 'alice')
    assert.equal(session.json.user.admin, true)
    const bobSession = await bob.get('/api/auth/session')
    assert.equal(bobSession.json.user.admin, false)
    const config = await alice.get('/api/config')
    assert.equal(config.json.auth.user.admin, true)

    // Non-admins get 403s on the directory.
    assert.equal((await bob.get('/api/admin/users')).status, 403)
    assert.equal((await bob.post('/api/admin/users', { username: 'carol' })).status, 403)

    // The admin lists the directory, pre-creates an account, and edits it.
    assert.deepEqual(
      (await alice.get('/api/admin/users')).json.users.map((u) => u.username),
      ['alice', 'bob'],
    )
    const created = await alice.post('/api/admin/users', {
      username: 'Carol',
      displayName: 'Carol Novak',
      departments: ['cs', 'MAT'],
    })
    assert.equal(created.status, 201)
    assert.equal(created.json.user.username, 'carol')
    assert.equal(created.json.user.displayName, 'Carol Novak')
    assert.deepEqual(created.json.user.departments, ['CS', 'MAT'], 'prefixes canonicalize uppercased')

    // The pre-created account is there (signs in later as the same identity).
    const carolLogin = await srv.newClient().post('/api/auth/login', { username: 'carol' })
    assert.equal(carolLogin.status, 200)

    // Editing: display name can be cleared, departments replaced.
    const patched = await alice.patch(`/api/admin/users/${created.json.user.id}`, {
      displayName: '',
      departments: ['BIO'],
    })
    assert.equal(patched.status, 200)
    assert.equal(patched.json.user.displayName, null)
    assert.deepEqual(patched.json.user.departments, ['BIO'])

    // Bad input is refused.
    assert.equal(
      (await alice.patch(`/api/admin/users/${created.json.user.id}`, { departments: 'CS' })).status,
      400,
    )
    assert.equal((await alice.patch(`/api/admin/users/99999`, { displayName: 'X' })).status, 404)
  } finally {
    srv.close()
    database.close()
  }
})

test('username autocomplete searches the directory for any signed-in user', async () => {
  const database = await openDb(':memory:')
  const app = createApp({
    database,
    services: ['schedule'],
    adminUsernames: new Set(['alice']),
  })
  const srv = await startTestServer(app)
  try {
    const alice = srv.newClient()
    assert.equal((await alice.post('/api/auth/login', { username: 'alice' })).status, 200)
    await alice.post('/api/admin/users', {
      username: 'wahl',
      displayName: 'John Wahl',
      departments: ['CS'],
    })
    await alice.post('/api/admin/users', {
      username: 'bob',
      displayName: 'Bob Skiadas',
      departments: ['MAT'],
    })

    // A plain signed-in user (not an admin) can autocomplete names.
    const carol = srv.newClient()
    assert.equal((await carol.post('/api/auth/login', { username: 'carol' })).status, 200)
    const byName = await carol.get('/api/users?q=wahl')
    assert.equal(byName.status, 200)
    assert.deepEqual(
      byName.json.users.map((u) => u.username),
      ['wahl'],
    )
    assert.equal(byName.json.users[0].displayName, 'John Wahl')
    const byDisplay = await carol.get('/api/users?q=skiadas')
    assert.deepEqual(
      byDisplay.json.users.map((u) => u.username),
      ['bob'],
    )
    // Empty query returns the whole directory (bounded) — carol herself was
    // JIT-provisioned by her login.
    const all = await carol.get('/api/users')
    assert.equal(all.json.users.length, 4)
    // Anonymous is refused.
    const anon = srv.newClient()
    assert.equal((await anon.get('/api/users?q=wahl')).status, 401)
  } finally {
    srv.close()
    database.close()
  }
})

test('non-owner suggestions are scoped to their directory departments', async () => {
  const database = await openDb(':memory:')
  const app = createApp({
    database,
    services: ['schedule'],
    adminUsernames: new Set(['alice']),
  })
  const srv = await startTestServer(app)
  try {
    const alice = srv.newClient()
    const bob = srv.newClient()
    assert.equal((await alice.post('/api/auth/login', { username: 'alice' })).status, 200)
    assert.equal((await bob.post('/api/auth/login', { username: 'bob' })).status, 200)
    // Bob belongs to CS only.
    const created = await alice.post('/api/admin/users', {
      username: 'bob',
      displayName: 'Bob Wahl',
      departments: ['CS'],
    })
    assert.equal(created.status, 201)

    const { schedule } = (await alice.post('/api/schedules', { name: 'Dept' })).json
    await alice.patch(`/api/schedules/${schedule.id}`, { visibility: 'public', suggestMode: 'public' })
    await alice.put(`/api/schedules/${schedule.id}/terms/F`, {
      offerings: [
        { prefix: 'CS', number: '220', section: 'A', days: 'MWF', time: '9:20-10:30' },
        { prefix: 'MAT', number: '131', section: 'A', days: 'TR', time: '10:00-11:45' },
      ],
    })
    const term = (await alice.get(`/api/schedules/${schedule.id}/terms/F`)).json.term

    // Bob can propose a CS change…
    const ok = await bob.post(`/api/schedules/${schedule.id}/suggestions`, {
      term: 'F',
      baseVersion: term.version,
      operations: [
        {
          kind: 'update',
          cur: { prefix: 'CS', number: '220', section: 'A' },
          changes: { time: '12:00-13:10' },
          diff: [],
        },
      ],
    })
    assert.equal(ok.status, 201)

    // …but a MAT change is refused with the offending code named.
    const denied = await bob.post(`/api/schedules/${schedule.id}/suggestions`, {
      term: 'F',
      baseVersion: term.version,
      operations: [
        {
          kind: 'update',
          cur: { prefix: 'MAT', number: '131', section: 'A' },
          changes: { time: '14:15-16:00' },
          diff: [],
        },
      ],
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.json.error, 'dept_restricted')
    assert.match(denied.json.codes, /MAT 131/)

    // A mixed proposal fails on the first out-of-scope op.
    const mixed = await bob.post(`/api/schedules/${schedule.id}/suggestions`, {
      term: 'F',
      baseVersion: term.version,
      operations: [
        {
          kind: 'update',
          cur: { prefix: 'CS', number: '220', section: 'A' },
          changes: { time: '12:00-13:10' },
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
    assert.equal(mixed.status, 403)

    // The owner is exempt: alice can propose anything.
    const ownerOp = await alice.post(`/api/schedules/${schedule.id}/suggestions`, {
      term: 'F',
      baseVersion: term.version,
      operations: [
        {
          kind: 'update',
          cur: { prefix: 'MAT', number: '131', section: 'A' },
          changes: { time: '14:15-16:00' },
          diff: [],
        },
      ],
    })
    assert.equal(ownerOp.status, 201)
  } finally {
    srv.close()
    database.close()
  }
})
