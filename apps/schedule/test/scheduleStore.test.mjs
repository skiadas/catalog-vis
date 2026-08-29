// Schedule store integration tests: the store runs under plain node --test
// against a real in-process API server (see helpers.mjs). These cover the
// store's state machines — sign-in/load, awaited creation (no optimistic
// ghosts), suggestion refreshes keyed to server-owned ids, non-owner suggest
// consolidation/upsert/rebase, and the offline trail.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'

import { withRemote, flush } from './helpers.mjs'

const COURSE = {
  prefix: 'CS',
  number: '220',
  section: 'A',
  days: 'MWF',
  time: '9:20-10:30',
  instructor: 'Wahl',
}

function emptyTerms() {
  return {
    F: { offerings: [], version: 0 },
    W: { offerings: [], version: 0 },
    S: { offerings: [], version: 0 },
  }
}

async function freePort() {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

test('signIn loads the shared schedules from the server and selects the first', async () => {
  await withRemote(async ({ srv, store }) => {
    await srv.post('/api/auth/login', { username: 'registrar' })
    const created = (await srv.post('/api/schedules', { name: 'Shared', year: '2026-27' })).json.schedule

    assert.equal(await store.signIn('registrar'), true)
    assert.equal(store.currentUser.value.username, 'registrar')
    assert.equal(store.schedules.value.length, 1)
    assert.equal(store.schedules.value[0].id, created.id)
    assert.deepEqual(store.selectedScheduleIds.value, [created.id])
    // Every entry is server-owned now (integer ids).
    assert.equal(
      store.schedules.value.every((s) => Number.isInteger(s.id)),
      true,
    )
  })
})

test('refreshAllSuggestions never fetches suggestions for client-only schedule ids', async () => {
  await withRemote(async ({ srv, store }) => {
    await srv.post('/api/auth/login', { username: 'registrar' })
    const created = (await srv.post('/api/schedules', { name: 'Shared' })).json.schedule
    await store.signIn('alice')

    // A stale/un-synced entry (no server ownership) sits in the local list.
    store.schedules.value = [
      ...store.schedules.value,
      { id: 'sched_ghost', name: 'Ghost', year: '', terms: emptyTerms(), owner_user_id: null },
    ]
    store.selectedScheduleIds.value = [created.id, 'sched_ghost']

    store.refreshAllSuggestions()
    await flush()

    // The real schedule was refreshed; the ghost was skipped entirely (no key
    // is recorded for it — a fetch would 404 but still set an entry).
    assert.ok(Array.isArray(store.suggestionsBySchedule.value[created.id]))
    assert.equal(store.suggestionsBySchedule.value['sched_ghost'], undefined)
  })
})

test('addSchedule waits for the server; a failed create leaves no ghost', async () => {
  await withRemote(async ({ srv, store, base }) => {
    await store.signIn('alice')

    const id = await store.addSchedule('Real', '2026-27', [])
    assert.ok(Number.isInteger(id))
    assert.equal(store.schedules.value.length, 1)
    assert.equal(store.schedules.value[0].name, 'Real')

    // A dead API leaves the collection untouched (no optimistic ghost stays).
    const { setApiBase } = await import('../src/backend.js')
    setApiBase(`http://127.0.0.1:${await freePort()}/api`)
    assert.equal(await store.addSchedule('Ghost', '2026-27', []), null)
    assert.equal(store.schedules.value.length, 1)
    assert.equal(store.schedules.value[0].name, 'Real')
  })
})

test('addSchedule seeds the active term on the server once the create lands', async () => {
  await withRemote(async ({ srv, store }) => {
    await store.signIn('alice')
    const id = await store.addSchedule('Seeded', '2026-27', [COURSE])
    await flush() // the fire-and-forget term PUT settles
    const term = (await srv.get(`/api/schedules/${id}/terms/F`)).json.term
    assert.equal(term.offerings.length, 1)
    assert.equal(term.offerings[0].prefix, 'CS')
  })
})

test('non-owner suggest sessions consolidate into one upserted proposal; external approvals rebase later sessions', async () => {
  await withRemote(async ({ srv, store }) => {
    const registrar = srv.newClient()
    await registrar.post('/api/auth/login', { username: 'registrar' })
    const schedule = (await registrar.post('/api/schedules', { name: 'Shared' })).json.schedule
    await registrar.put(`/api/schedules/${schedule.id}/terms/F`, { offerings: [COURSE] })

    // Physics signs in via the store and enters a suggest session.
    assert.equal(await store.signIn('physics'), true)
    assert.equal(await store.setEditingSchedule(schedule.id, 'suggest'), true)
    assert.ok(store.pendingDrafts.value[`${schedule.id}:F`])

    // Two moves in one session: only the final state enters the proposal.
    store.moveOffering(schedule.id, 'CS', '220', 'A', {
      fromDay: 'M',
      toDay: 'T',
      group: 'TR',
      time: '10:00-11:45',
    })
    store.moveOffering(schedule.id, 'CS', '220', 'A', {
      fromDay: 'T',
      toDay: 'T',
      group: 'TR',
      time: '14:15-16:00',
    })
    const proposed = await store.proposeDraft(schedule.id, 'physics move')
    assert.ok(proposed)
    assert.equal(proposed.status, 'pending')
    assert.equal(proposed.operations.length, 1)
    assert.equal(proposed.operations[0].kind, 'update')
    assert.equal(proposed.operations[0].changes.time, '14:15-16:00')

    // Re-proposing an unchanged draft is a no-op; editing again upserts the
    // same row (still one pending suggestion for physics).
    assert.equal(await store.proposeDraft(schedule.id, ''), null)
    store.moveOffering(schedule.id, 'CS', '220', 'A', {
      fromDay: 'T',
      toDay: 'T',
      group: 'TR',
      time: '8:00-9:45',
    })
    const revised = await store.proposeDraft(schedule.id, '')
    assert.ok(revised)
    assert.equal(revised.id, proposed.id)
    assert.equal(revised.operations[0].changes.time, '8:00-9:45')
    const own = store.suggestionsBySchedule.value[schedule.id].filter((s) => s.status === 'pending')
    assert.equal(own.length, 1)

    // The owner approves; physics sees the resolved history.
    const approved = await registrar.post(`/api/suggestions/${proposed.id}/approve`, {})
    assert.equal(approved.status, 200)
    await store.refreshSuggestions(schedule.id)
    const history = store.suggestionsBySchedule.value[schedule.id]
    assert.equal(history[0].status, 'approved')

    // The term moved on (owner added a course directly). A NEW suggest session
    // replays physics' own pending ops onto the fresh base: another proposal
    // (BIO -> TR) survives, while the owner's additions stay part of the base.
    const withBio = [
      { ...COURSE, days: 'TR', time: '8:00-9:45' },
      { prefix: 'BIO', number: '161', section: 'A', days: 'MWF', time: '8:00-9:10' },
    ]
    await registrar.put(`/api/schedules/${schedule.id}/terms/F`, { offerings: withBio })
    await store.refreshSuggestions(schedule.id)
    await store.setEditingSchedule(null)
    assert.equal(await store.setEditingSchedule(schedule.id, 'suggest'), true)

    store.moveOffering(schedule.id, 'BIO', '161', 'A', {
      fromDay: 'M',
      toDay: 'T',
      group: 'TR',
      time: '14:15-16:00',
    })
    const bioProposal = await store.proposeDraft(schedule.id, '')
    assert.ok(bioProposal)
    assert.equal(bioProposal.operations.length, 1)
    assert.equal(bioProposal.operations[0].cur.number, '161')

    // The owner adds MAT 131 without approving BIO's proposal; physics re-
    // enters suggest: the draft = fresh published state + replayed own ops.
    const withMat = [
      ...withBio,
      { prefix: 'MAT', number: '131', section: 'A', days: 'MWF', time: '12:00-13:10' },
    ]
    await registrar.put(`/api/schedules/${schedule.id}/terms/F`, { offerings: withMat })
    await store.refreshSuggestions(schedule.id)
    await store.setEditingSchedule(null)
    assert.equal(await store.setEditingSchedule(schedule.id, 'suggest'), true)

    const draft = store.termOfferings(store.scheduleById(schedule.id))
    const byCode = (code) => draft.find((o) => `${o.prefix} ${o.number}` === code)
    assert.ok(byCode('MAT 131'), 'owner addition stays in the base')
    assert.equal(byCode('BIO 161').time, '14:15-16:00', 'own pending intent replayed')
    assert.equal(byCode('CS 220').time, '8:00-9:45', 'approved state stays in the base')

    // physics may still withdraw the pending BIO proposal.
    const bio = store.suggestionsBySchedule.value[schedule.id].find((s) => s.status === 'pending')
    assert.ok(bio)
    assert.equal(await store.withdrawSuggestion(bio.id), true)
  })
})

test('offline trail mirrors the lifecycle: propose, withdraw, propose again, self-approve', async () => {
  await withRemote(async ({ store }) => {
    // Make the store offline for this test (same process, remote back off).
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('Local', '2026-27', [])
    store.addCourseToSchedule(id, 'CS 101')
    await store.setEditingSchedule(id, 'suggest')
    store.moveOffering(id, 'CS', '101', 'A', { fromDay: 'M', toDay: 'T', group: 'TR', time: '10:00-11:45' })

    const row = await store.proposeDraft(id, 'offline')
    assert.equal(row.status, 'pending')
    assert.equal(store.suggestionsBySchedule.value[id].length, 1)

    // Withdraw leaves the trail honest.
    assert.equal(await store.withdrawSuggestion(row.id), true)
    let rows = JSON.parse(localStorage.getItem('major-vis.schedule.suggestions'))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'withdrawn')

    // A new proposal, then self-approve applies it locally (no server).
    await store.setEditingSchedule(id, 'suggest')
    store.moveOffering(id, 'CS', '101', 'A', { fromDay: 'T', toDay: 'T', group: 'TR', time: '14:15-16:00' })
    const row2 = await store.proposeDraft(id, '')
    assert.ok(row2)
    assert.equal(await store.approveSuggestion(row2.id), true)
    rows = JSON.parse(localStorage.getItem('major-vis.schedule.suggestions'))
    assert.equal(rows.length, 2)
    assert.equal(rows.find((r) => r.id === row2.id).status, 'approved')
    const term = store.termOfferings(store.scheduleById(id))
    const course = term.find((o) => o.number === '101')
    assert.equal(course.days, 'TR')
    assert.equal(course.time, '14:15-16:00')
  })
})
