// Schedule store integration tests: the store runs under plain node --test
// against a real in-process API server (see helpers.mjs). These cover the
// store's state machines — sign-in/load, awaited creation (no optimistic
// ghosts), suggestion refreshes keyed to server-owned ids, non-owner suggest
// consolidation/upsert/rebase, and the offline trail.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'

import { withRemote, flush, resetStore } from './helpers.mjs'

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

test('boot without a session opens the auth prompt and fetches no schedules', async () => {
  await withRemote(async ({ store }) => {
    await store.initScheduleCollection()
    assert.equal(store.serverDetected.value, true)
    assert.equal(store.remote.value, true)
    assert.equal(store.authPromptOpen.value, true, 'no session -> prompt, not a 401 flood')
    assert.equal(store.currentUser.value, null)
    assert.equal(store.schedules.value.length, 0)
  })
})

test('workOffline seeds the local sample and a re-boot stays offline without prompting', async () => {
  await withRemote(async ({ store }) => {
    await store.initScheduleCollection()
    assert.equal(store.authPromptOpen.value, true)

    store.workOffline()
    assert.equal(store.remote.value, false)
    assert.equal(store.offlineMode.value, true)
    assert.equal(store.authPromptOpen.value, false)
    assert.equal(localStorage.getItem('major-vis.schedule.offline'), '1')
    assert.ok(store.schedules.value.length > 0, 'sample schedule seeded locally')

    // Simulate a reload: the remembered offline choice skips the prompt.
    store.schedules.value = []
    store.setRemote(true)
    store.serverDetected.value = false
    await store.initScheduleCollection()
    assert.equal(store.remote.value, false)
    assert.equal(store.authPromptOpen.value, false)
    assert.ok(store.schedules.value.length > 0)
  })
})

test('resumeOnline from offline restores the server view when a session is live', async () => {
  await withRemote(async ({ store }) => {
    await store.initScheduleCollection()
    assert.equal(store.authPromptOpen.value, true)
    // Sign in (session cookie lands in the fetch shim), then choose offline.
    assert.equal(await store.signIn('registrar'), true)
    assert.equal(store.currentUser.value.username, 'registrar')
    store.closeAuthPrompt()
    store.workOffline()
    assert.equal(store.offlineMode.value, true)
    assert.ok(store.schedules.value.length > 0, 'local sample replaces the server view')

    // Going online picks the session back up: server state fully replaces the
    // offline work (which never transfers).
    assert.equal(await store.resumeOnline(), true)
    assert.equal(store.remote.value, true)
    assert.equal(store.offlineMode.value, false)
    assert.equal(store.authPromptOpen.value, false)
    assert.equal(store.currentUser.value.username, 'registrar')
    assert.equal(store.schedules.value.length, 0, 'empty server collection (offline work not merged)')
  })
})

test('resumeOnline without a session leaves online mode for the sign-in form', async () => {
  await withRemote(async ({ store }) => {
    await store.initScheduleCollection()
    store.workOffline()
    assert.equal(store.offlineMode.value, true)
    assert.equal(await store.resumeOnline(), false, 'no session -> form, not a restore')
    assert.equal(store.remote.value, true)
    assert.equal(localStorage.getItem('major-vis.schedule.offline'), null, 'offline choice cleared')
  })
})

test('serverless boot seeds the local sample schedule directly', async () => {
  const store = await import('../src/scheduleStore.js')
  const { setApiBase } = await import('../src/backend.js')
  const port = await freePort()
  setApiBase(`http://127.0.0.1:${port}/api`)
  try {
    resetStore(store)
    store.setRemote(true) // stale remote flag from an earlier test; init overrides
    await store.initScheduleCollection()
    assert.equal(store.serverDetected.value, false)
    assert.equal(store.remote.value, false)
    assert.equal(store.authPromptOpen.value, false)
    assert.ok(store.schedules.value.length > 0, 'sample schedule seeded')
  } finally {
    resetStore(store)
  }
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
  await withRemote(async ({ store }) => {
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
    assert.equal(proposed.operations[0].op.kind, 'update')
    assert.equal(proposed.operations[0].op.changes.time, '14:15-16:00')
    assert.equal(proposed.operations[0].resolution.status, 'pending')

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
    assert.equal(revised.operations[0].op.changes.time, '8:00-9:45')
    const own = store.suggestionsBySchedule.value[schedule.id].filter((s) => s.status === 'pending')
    assert.equal(own.length, 1)

    // The owner approves it; physics sees the resolved history.
    // The upserted revision replaced the ops (new child rows), so approve the
    // current revision's op id.
    const approved = await registrar.post(`/api/suggestions/${revised.id}/approve`, {
      opId: revised.operations[0].id,
    })
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
    assert.equal(bioProposal.operations[0].op.cur.number, '161')
    assert.equal(bioProposal.operations[0].resolution.status, 'pending')

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

    const draft = store.viewOfferings(store.scheduleById(schedule.id))
    const byCode = (code) => draft.find((o) => `${o.prefix} ${o.number}` === code)
    assert.ok(byCode('MAT 131'), 'owner addition stays in the base')
    assert.equal(byCode('BIO 161').time, '14:15-16:00', 'own pending intent replayed')
    assert.equal(byCode('CS 220').time, '8:00-9:45', 'approved state stays in the base')

    // physics may still withdraw the pending BIO proposal.
    const bio = store.suggestionsBySchedule.value[schedule.id].find((s) => s.status === 'pending')
    assert.ok(bio)
    assert.ok(await store.withdrawSuggestion(bio.id))
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
    assert.ok(await store.withdrawSuggestion(row.id))
    let rows = JSON.parse(localStorage.getItem('major-vis.schedule.suggestions'))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'withdrawn')

    // A new proposal, then self-approve applies it locally (no server).
    await store.setEditingSchedule(id, 'suggest')
    store.moveOffering(id, 'CS', '101', 'A', { fromDay: 'T', toDay: 'T', group: 'TR', time: '14:15-16:00' })
    const row2 = await store.proposeDraft(id, '')
    assert.ok(row2)
    const resolved = await store.resolveOp(row2.id, row2.operations[0].id, 'accepted')
    assert.ok(resolved)
    assert.equal(resolved.status, 'approved')
    rows = JSON.parse(localStorage.getItem('major-vis.schedule.suggestions'))
    assert.equal(rows.length, 2)
    assert.equal(rows.find((r) => r.id === row2.id).status, 'approved')
    const term = store.publishedOfferings(store.scheduleById(id))
    const course = term.find((o) => o.number === '101')
    assert.equal(course.days, 'TR')
    assert.equal(course.time, '14:15-16:00')
  })
})

test('publishedOfferings stays published during a suggest session; viewOfferings shows the draft', async () => {
  await withRemote(async ({ store }) => {
    // Make the store offline for this test (same process, remote back off).
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('Local', '2026-27', [])
    store.addCourseToSchedule(id, 'CS 101')
    await store.setEditingSchedule(id, 'suggest')
    store.moveOffering(id, 'CS', '101', 'A', { fromDay: 'M', toDay: 'T', group: 'TR', time: '10:00-11:45' })

    const s = store.scheduleById(id)
    const published = store.publishedOfferings(s)
    const viewed = store.viewOfferings(s)
    assert.equal(published.length, 1)
    assert.equal(published[0].days, 'MWF', 'published part is untouched by draft edits')
    assert.equal(published[0].time, '8:00-9:10')
    assert.equal(viewed[0].days, 'TR', 'view part renders the draft during a suggest session')
    assert.equal(viewed[0].time, '10:00-11:45')
  })
})

test('offline per-op resolution: accept one change, reject the other, row finalizes only when all resolve', async () => {
  await withRemote(async ({ store }) => {
    // Make the store offline for this test (same process, remote back off).
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('Local', '2026-27', [])
    store.addCourseToSchedule(id, 'CS 101')
    await store.setEditingSchedule(id, 'suggest')
    store.moveOffering(id, 'CS', '101', 'A', { fromDay: 'M', toDay: 'T', group: 'TR', time: '10:00-11:45' })
    store.addCourseToSchedule(id, 'BIO 161')

    const row = await store.proposeDraft(id, 'two changes')
    assert.equal(row.operations.length, 2)

    // Accepting the first change applies only it; the row stays pending.
    const [moveEntry, addEntry] = row.operations
    const first = await store.resolveOp(row.id, moveEntry.id, 'accepted')
    assert.ok(first)
    assert.equal(first.status, 'pending')
    assert.equal(first.operations[0].resolution.status, 'accepted')
    assert.equal(first.operations[1].resolution.status, 'pending')
    // viewOfferings renders the draft during a suggest session; read the
    // published part to see what the accept actually published.
    let published = store.scheduleById(id).terms.F.offerings
    assert.equal(published.find((o) => o.number === '101').days, 'TR', 'accepted move applied')
    assert.ok(!published.some((o) => o.number === '161'), 'unresolved add NOT applied')

    // Rejecting the second change finalizes the row as approved (one applied).
    const second = await store.resolveOp(row.id, addEntry.id, 'rejected')
    assert.ok(second)
    assert.equal(second.status, 'approved')
    assert.equal(second.operations[1].resolution.status, 'rejected')
    const trail = JSON.parse(localStorage.getItem('major-vis.schedule.suggestions'))
    assert.equal(trail.length, 1)
    assert.equal(trail[0].status, 'approved')
    assert.deepEqual(
      trail[0].operations.map((e) => e.resolution.status),
      ['accepted', 'rejected'],
    )

    // The published term still lacks the rejected course.
    published = store.scheduleById(id).terms.F.offerings
    assert.ok(!published.some((o) => o.number === '161'))

    // Per-op withdrawal: pulling one change keeps the row live; the other op
    // stays resolvable. Withdrawing it all finalizes as 'withdrawn'.
    await store.setEditingSchedule(id, 'suggest')
    store.moveOffering(id, 'CS', '101', 'A', { fromDay: 'T', toDay: 'T', group: 'TR', time: '8:00-9:45' })
    await store.setEditingSchedule(null)
    await store.setEditingSchedule(id, 'suggest')
    store.addCourseToSchedule(id, 'BIO 161')
    const row3 = await store.proposeDraft(id, 'withdraw me')
    assert.equal(row3.operations.length, 2)
    const [opA] = row3.operations
    const partial = await store.withdrawSuggestion(row3.id, opA.id)
    assert.ok(partial)
    assert.equal(partial.status, 'pending', 'one unsettled op keeps the row live')
    assert.equal(partial.operations[0].resolution.status, 'withdrawn')
    assert.equal(partial.operations[1].resolution.status, 'pending')
    assert.ok(partial.operations[0].resolution.resolved_at)
    const all = await store.withdrawSuggestion(row3.id)
    assert.ok(all)
    assert.equal(all.status, 'withdrawn')
    assert.deepEqual(
      all.operations.map((e) => e.resolution.status),
      ['withdrawn', 'withdrawn'],
    )
    assert.ok(all.resolved_at)

    // Resolving an already-resolved op is refused.
    assert.equal(await store.resolveOp(row.id, moveEntry.id, 'accepted'), null)
    assert.equal(await store.resolveOp(row.id, 'unknown_id', 'rejected'), null)
    assert.equal(await store.resolveOp(row.id, moveEntry.id, 'rejected'), null)
  })
})

test('updateOffering never leaves a half-set meeting time', async () => {
  await withRemote(async ({ store }) => {
    // Make the store offline for this test (same process, remote back off).
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('Local', '2026-27', [])
    store.addCourseToSchedule(id, 'CS 101')

    // Wiping the time alone blanks the days too (the no-meeting-time shape).
    assert.ok(
      store.updateOffering(
        id,
        { prefix: 'CS', number: '101', section: 'A' },
        { instructor: 'Wahl', time: '' },
      ),
    )
    let viewed = store.viewOfferings(store.scheduleById(id))
    assert.equal(viewed[0].instructor, 'Wahl')
    assert.equal(viewed[0].days, '')
    assert.equal(viewed[0].time, '')

    // A fully-set change passes through untouched.
    assert.ok(
      store.updateOffering(
        id,
        { prefix: 'CS', number: '101', section: 'A' },
        { days: 'MWF', time: '8:00-9:10' },
      ),
    )
    viewed = store.viewOfferings(store.scheduleById(id))
    assert.equal(viewed[0].days, 'MWF')
    assert.equal(viewed[0].time, '8:00-9:10')
  })
})

test('updateOffering persists a secondaryInstructors change', async () => {
  await withRemote(async ({ store }) => {
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('Local', '2026-27', [])
    store.addCourseToSchedule(id, 'CS 101')
    assert.ok(
      store.updateOffering(
        id,
        { prefix: 'CS', number: '101', section: 'A' },
        { instructor: 'Wahl', secondaryInstructors: ['Xu', 'Ray'] },
      ),
    )
    let viewed = store.viewOfferings(store.scheduleById(id))
    assert.deepEqual(viewed[0].secondaryInstructors, ['Xu', 'Ray'])

    // Clearing the list is a valid change too (0-or-more other instructors).
    assert.ok(
      store.updateOffering(id, { prefix: 'CS', number: '101', section: 'A' }, { secondaryInstructors: [] }),
    )
    viewed = store.viewOfferings(store.scheduleById(id))
    assert.deepEqual(viewed[0].secondaryInstructors, [])
  })
})

test('addLabSection creates an unscheduled lab that mirrors the lecture and copies its instructor', async () => {
  await withRemote(async ({ store }) => {
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('Local', '2026-27', [])
    store.addCourseToSchedule(id, 'BIO 166')
    assert.ok(
      store.updateOffering(
        id,
        { prefix: 'BIO', number: '166', section: 'A' },
        { instructor: 'Patterson', secondaryInstructors: ['Xu', 'Ray'] },
      ),
    )

    const lab = store.addLabSection(id, { prefix: 'BIO', number: '166', section: 'A' })
    assert.ok(lab)
    assert.equal(lab.lab, true)
    assert.equal(lab.section, 'A', 'mirrors the lecture letter')
    assert.equal(lab.instructor, 'Patterson', 'copies the lecture instructor as it stands')
    assert.deepEqual(lab.secondaryInstructors, ['Xu', 'Ray'], 'copies the secondary instructors too')
    assert.equal(lab.days, '')
    assert.equal(lab.time, '', 'starts unscheduled')
    assert.equal(lab.labSeq, 1)

    // A second lab for the same lecture gets the next sequence number, and
    // they remain distinct rows at the same section letter.
    const lab2 = store.addLabSection(id, { prefix: 'BIO', number: '166', section: 'A' })
    assert.equal(lab2.labSeq, 2)
    const rows = store.scheduleById(id).terms.F.offerings
    assert.equal(rows.length, 3)
    assert.equal(rows.filter((o) => o.lab).length, 2)

    // A lab cannot spawn a lab; unknown lectures return null (no orphan labs).
    assert.equal(
      store.addLabSection(id, { prefix: 'BIO', number: '166', section: 'A', lab: true, labSeq: 1 }),
      null,
    )
    assert.equal(store.addLabSection(id, { prefix: 'MAT', number: '131', section: 'A' }), null)
  })
})

test('moveOffering drags a lab row without disturbing the lecture at the same letter', async () => {
  await withRemote(async ({ store }) => {
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('Local', '2026-27', [])
    store.addCourseToSchedule(id, 'BIO 166')
    store.addLabSection(id, { prefix: 'BIO', number: '166', section: 'A' })

    assert.ok(
      store.moveOffering(
        id,
        'BIO',
        '166',
        'A',
        { fromDay: 'T', toDay: 'R', group: 'TR', time: '10:00-11:45' },
        true,
        1,
      ),
    )
    const rows = store.scheduleById(id).terms.F.offerings
    const lab = rows.find((o) => o.lab)
    const lecture = rows.find((o) => !o.lab)
    assert.equal(lab.time, '10:00-11:45')
    assert.equal(lecture.time, '8:00-9:10', 'lecture untouched')
  })
})

test('importCsvRows seeds term parts grouped by the term column on a local schedule', async () => {
  const store = await import('../src/scheduleStore.js')
  const { setApiBase } = await import('../src/backend.js')
  setApiBase(`http://127.0.0.1:${await freePort()}/api`)
  try {
    resetStore(store)
    const id = await store.addSchedule('Imported', '', [])
    const written = store.importCsvRows(id, [
      {
        prefix: 'CS',
        number: '220',
        section: 'A',
        instructor: 'Wahl',
        days: 'MWF',
        time: '9:20-10:30',
        term: 'F',
      },
      {
        prefix: 'BIO',
        number: '166',
        section: 'A',
        instructor: 'Patterson',
        days: 'TR',
        time: '10:00-11:45',
        term: 'S',
        lab: true,
        labSeq: 1,
      },
      { prefix: 'MAT', number: '131', section: 'A', instructor: 'Aydogan', days: 'MWF', time: '12:00-13:10' },
    ])
    assert.deepEqual(written, { F: 2, S: 1 })
    const s = store.scheduleById(id)
    assert.deepEqual(
      s.terms.F.offerings.map((o) => `${o.prefix} ${o.number}`),
      ['CS 220', 'MAT 131'],
      'no-term rows default to the active term part',
    )
    assert.equal(s.terms.W.offerings.length, 0)
    assert.equal(s.terms.S.offerings[0].lab, true)
    assert.equal(s.terms.S.offerings[0].term, undefined, 'term key never leaks into the offering')
  } finally {
    resetStore(store)
  }
})

test('importCsvRows on a missing schedule is a no-op', async () => {
  const store = await import('../src/scheduleStore.js')
  const { setApiBase } = await import('../src/backend.js')
  setApiBase(`http://127.0.0.1:${await freePort()}/api`)
  try {
    resetStore(store)
    assert.deepEqual(store.importCsvRows('nope', []), {})
  } finally {
    resetStore(store)
  }
})

test('importCsvRows is blocked for a remote non-owner and applied for the owner', async () => {
  await withRemote(async ({ srv, store }) => {
    await srv.post('/api/auth/login', { username: 'registrar' })
    const created = (await srv.post('/api/schedules', { name: 'Shared', year: '2026-27' })).json.schedule
    await store.signIn('alice')

    const rows = [
      {
        prefix: 'CS',
        number: '220',
        section: 'A',
        instructor: 'Wahl',
        days: 'MWF',
        time: '9:20-10:30',
        term: 'F',
      },
    ]
    assert.deepEqual(store.importCsvRows(created.id, rows), {}, 'non-owner replace is blocked')
    await flush()
    assert.equal(store.scheduleById(created.id).terms.F.offerings.length, 0)

    await store.signIn('registrar')
    assert.deepEqual(store.importCsvRows(created.id, rows), { F: 1 })
    await flush()
    const term = (await srv.get(`/api/schedules/${created.id}/terms/F`)).json.term
    assert.equal(term.offerings.length, 1)
    assert.equal(term.offerings[0].prefix, 'CS')
  })
})

test('importCsvRows rerunning replaces the touched parts (registrar re-feed)', async () => {
  await withRemote(async ({ srv, store }) => {
    await srv.post('/api/auth/login', { username: 'registrar' })
    const created = (await srv.post('/api/schedules', { name: 'Shared' })).json.schedule
    await store.signIn('registrar')

    const first = { prefix: 'CS', number: '101', section: 'A', days: 'MWF', time: '8:00-9:10', term: 'F' }
    const second = { prefix: 'CS', number: '220', section: 'B', days: 'TR', time: '10:00-11:45', term: 'F' }
    store.importCsvRows(created.id, [first])
    store.importCsvRows(created.id, [second])
    await flush()
    const term = (await srv.get(`/api/schedules/${created.id}/terms/F`)).json.term
    assert.equal(term.offerings.length, 1, 're-feed replaces the part, it does not append')
    assert.equal(term.offerings[0].number, '220')
  })
})

// ---------------------------------------------------------------------------
// Session change list (net-diff history: one row per course, individual cancel)
// ---------------------------------------------------------------------------

test('history: net-diff rows collapse moves and vanish when a course returns to base', async () => {
  await withRemote(async ({ store }) => {
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('NetHist', '2026-27', [])
    store.addCourseToSchedule(id, 'CS 101')
    await store.setEditingSchedule(id, 'edit')
    assert.equal(store.canCancel.value, false, 'a fresh session has nothing to cancel')

    // Move there and back: nets to zero, no row at all.
    store.moveOffering(id, 'CS', '101', 'A', { fromDay: 'M', toDay: 'T', group: 'TR', time: '10:00-11:45' })
    store.moveOffering(id, 'CS', '101', 'A', { fromDay: 'T', toDay: 'M', group: 'MWF', time: '8:00-9:10' })
    assert.equal(store.historyEntries.value.length, 0, 'move + move back is no change')
    assert.equal(store.canCancel.value, false)

    // Moving a course twice nets to a single row.
    store.moveOffering(id, 'CS', '101', 'A', { fromDay: 'M', toDay: 'T', group: 'TR', time: '10:00-11:45' })
    store.moveOffering(id, 'CS', '101', 'A', { fromDay: 'T', toDay: 'W', group: 'MWF', time: '13:20-14:30' })
    let rows = store.historyEntries.value
    assert.equal(rows.length, 1, 'two moves collapse into one net change')
    assert.match(rows[0].label, /CS 101/)

    // Editing the same course merges into that one row; a second course is its
    // own (newer) row.
    store.updateOffering(id, { prefix: 'CS', number: '101', section: 'A' }, { instructor: 'Wahl' })
    rows = store.historyEntries.value
    assert.equal(rows.length, 1, 'same-course edits stay one net row')
    assert.match(rows[0].label, /instructor/)
    store.addCourseToSchedule(id, 'MAT 131')
    rows = store.historyEntries.value
    assert.equal(rows.length, 2, 'each affected course gets a row')
    assert.match(rows[0].label, /add MAT/, 'newest change first')
    assert.ok(store.canCancel.value)
  })
})

test('history: cancelling one change keeps the rest; restore brings it back', async () => {
  await withRemote(async ({ store }) => {
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('CancelHist', '2026-27', [])
    store.addCourseToSchedule(id, 'CS 101')
    await store.setEditingSchedule(id, 'edit')

    store.addCourseToSchedule(id, 'MAT 131')
    store.updateOffering(id, { prefix: 'CS', number: '101', section: 'A' }, { instructor: 'Wahl' })
    const before = store.viewOfferings(store.scheduleById(id))
    assert.equal(store.historyEntries.value.length, 2)

    const csRow = store.historyEntries.value.find((e) => e.label.includes('instructor'))
    const matRow = store.historyEntries.value.find((e) => e.label.includes('add MAT'))
    const version = store.scheduleById(id).terms.F.version
    assert.ok(store.cancelChange(csRow.key), 'the single change is cancellable')
    assert.equal(store.scheduleById(id).terms.F.version, version + 1, 'a cancel bumps the version like an edit')

    const after = store.viewOfferings(store.scheduleById(id))
    assert.equal(after.length, 2, 'the other change stays')
    assert.ok(after.some((o) => o.prefix === 'MAT'), 'the MAT add is untouched')
    assert.equal(after.find((o) => o.prefix === 'CS').instructor, '', 'only the instructor change was cancelled')

    let rows = store.historyEntries.value
    assert.equal(rows.length, 2, 'the cancelled row stays listed')
    assert.ok(rows.find((e) => e.label.includes('instructor')).cancelled)
    assert.ok(!rows.find((e) => e.label.includes('add MAT')).cancelled)
    assert.equal(store.canCancel.value, true)

    // Restore brings the instructor change back; state returns to `before`.
    assert.ok(store.restoreChange(csRow.key))
    assert.deepEqual(store.viewOfferings(store.scheduleById(id)), before)
    rows = store.historyEntries.value
    assert.ok(!rows.find((e) => e.label.includes('instructor')).cancelled)

    // Cancelling the add drops the course entirely; a second cancel of the
    // same row is refused.
    assert.ok(store.cancelChange(matRow.key))
    assert.deepEqual(
      store.viewOfferings(store.scheduleById(id)).map((o) => `${o.prefix} ${o.number}`),
      ['CS 101'],
    )
    assert.equal(store.cancelChange(matRow.key), null, 'already-cancelled rows refuse')
    assert.equal(store.canCancel.value, true, 'the restored CS instructor change is still live')
    assert.ok(store.cancelChange(csRow.key))
    assert.equal(store.canCancel.value, false, 'nothing live left to cancel')
  })
})

test('history: cancelAll returns the session to its base; rows stay listed as cancelled', async () => {
  await withRemote(async ({ store }) => {
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('AllHist', '2026-27', [])
    store.addCourseToSchedule(id, 'CS 101')
    const start = store.viewOfferings(store.scheduleById(id))

    await store.setEditingSchedule(id, 'edit')
    store.addCourseToSchedule(id, 'MAT 131')
    store.updateOffering(id, { prefix: 'CS', number: '101', section: 'A' }, { instructor: 'Wahl' })

    assert.ok(store.cancelAll())
    assert.deepEqual(store.viewOfferings(store.scheduleById(id)), start, 'back to the session base')
    assert.equal(store.canCancel.value, false)
    assert.equal(store.cancelAll(), false, 'nothing live -> no-op')
    const rows = store.historyEntries.value
    assert.equal(rows.length, 2)
    assert.ok(rows.every((e) => e.cancelled), 'every row stays listed as cancelled')

    // A restored row re-applies just that change on top of the base.
    const matRow = rows.find((e) => e.label.includes('add MAT'))
    assert.ok(store.restoreChange(matRow.key))
    assert.deepEqual(
      store.viewOfferings(store.scheduleById(id)).map((o) => o.number),
      ['101', '131'],
    )
    assert.equal(store.canCancel.value, true)
    assert.ok(store.cancelAll(), 'and cancels again in one step')
    assert.deepEqual(store.viewOfferings(store.scheduleById(id)), start)
  })
})

test('history: cancelLatest (Cmd/Ctrl+Z) cancels the newest live change, then the next', async () => {
  await withRemote(async ({ store }) => {
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('LatestHist', '2026-27', [])
    store.addCourseToSchedule(id, 'CS 101')
    await store.setEditingSchedule(id, 'edit')
    store.addCourseToSchedule(id, 'MAT 131')
    store.updateOffering(id, { prefix: 'CS', number: '101', section: 'A' }, { instructor: 'Wahl' })

    assert.match(store.cancelLatest(), /instructor/, 'newest change (CS instructor) cancels first')
    assert.equal(store.viewOfferings(store.scheduleById(id)).length, 2, 'MAT add untouched')
    assert.equal(store.viewOfferings(store.scheduleById(id)).find((o) => o.prefix === 'CS').instructor, '')
    assert.match(store.cancelLatest(), /add MAT/)
    assert.deepEqual(store.viewOfferings(store.scheduleById(id)).map((o) => o.number), ['101'])
    assert.equal(store.cancelLatest(), null, 'nothing left to cancel')
    assert.equal(store.canCancel.value, false)
  })
})

test('history: no session means cancels are no-ops; bulk replaces become per-course rows', async () => {
  await withRemote(async ({ store }) => {
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('BulkHist', '2026-27', [])
    store.addCourseToSchedule(id, 'CS 101')

    assert.equal(store.cancelLatest(), null, 'nothing to cancel without a session')
    assert.equal(store.canCancel.value, false)

    await store.setEditingSchedule(id, 'edit')
    store.setTermOfferings(id, 'F', [
      { prefix: 'CS', number: '220', section: 'A', instructor: 'Wahl', days: 'MWF', time: '9:20-10:30' },
      { prefix: 'BIO', number: '161', section: 'A', instructor: 'Patterson', days: 'MWF', time: '8:00-9:10' },
    ])
    let rows = store.historyEntries.value
    assert.equal(rows.length, 3, 'each net change is its own row (2 adds + 1 remove)')
    assert.ok(rows.some((e) => e.label === 'add CS 220 A'))
    assert.ok(rows.some((e) => e.label === 'add BIO 161 A'))
    assert.ok(rows.some((e) => e.label === 'remove CS 101 A'))

    // Cancelling one row of a bulk write keeps the rest of the replacement.
    const removeRow = rows.find((e) => e.label.startsWith('remove'))
    assert.ok(store.cancelChange(removeRow.key))
    assert.deepEqual(
      store.viewOfferings(store.scheduleById(id)).map((o) => o.number).sort(),
      ['101', '161', '220'],
      'only the removed CS 101 comes back',
    )

    // A larger second replace still nets per-course rows, never a summary.
    store.setTermOfferings(id, 'F', [
      { prefix: 'CS', number: '220', section: 'A', instructor: 'Wahl', days: 'MWF', time: '9:20-10:30' },
      { prefix: 'BIO', number: '161', section: 'A', instructor: 'Patterson', days: 'MWF', time: '8:00-9:10' },
      { prefix: 'BIO', number: '101', section: 'A', instructor: 'Doe', days: 'TR', time: '10:00-11:45' },
      { prefix: 'MAT', number: '120', section: 'A', instructor: 'Xu', days: 'MWF', time: '8:00-9:10' },
      { prefix: 'ENG', number: '111', section: 'A', instructor: 'Ray', days: 'TR', time: '13:20-14:30' },
      { prefix: 'CHE', number: '120', section: 'A', instructor: 'Wu', days: 'MWF', time: '12:00-13:10' },
    ])
    rows = store.historyEntries.value
    assert.equal(rows.length, 7, '6 adds + 1 remove, all live rows')
    assert.ok(rows.every((e) => !e.cancelled))
    assert.ok(!rows.some((e) => e.label.startsWith('Replaced')), 'no bulk summary label anymore')
    assert.ok(rows.some((e) => e.label === 'add CHE 120 A'))
    assert.ok(rows.some((e) => e.label === 'remove CS 101 A'))
  })
})

test('history: a no-op save records nothing and does not bump the version', async () => {
  await withRemote(async ({ store }) => {
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('NoopHist', '2026-27', [])
    store.addCourseToSchedule(id, 'CS 101')
    await store.setEditingSchedule(id, 'edit')
    const part = store.scheduleById(id).terms.F
    const version = part.version
    const rows = part.offerings

    // Re-saving an untouched course (the editor's no-change "Save changes")
    // is a no-op: no write, no version bump, no history entry.
    assert.equal(
      store.updateOffering(
        id,
        { prefix: 'CS', number: '101', section: 'A' },
        { instructor: '', secondaryInstructors: [], section: 'A', days: 'MWF', time: '8:00-9:10' },
      ),
      false,
    )
    assert.equal(store.scheduleById(id).terms.F.version, version, 'no version bump')
    assert.equal(store.scheduleById(id).terms.F.offerings, rows, 'offerings array untouched')
    assert.equal(store.historyEntries.value.length, 0, 'no "no change" entry in history')
    assert.equal(store.canCancel.value, false)
  })
})

test('history: suggest-session cancels rewrite the draft so proposals exclude them', async () => {
  await withRemote(async ({ store }) => {
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('SuggHist', '2026-27', [])
    store.addCourseToSchedule(id, 'CS 101')
    assert.equal(store.publishedOfferings(store.scheduleById(id)).length, 1)

    await store.setEditingSchedule(id, 'suggest')
    store.addCourseToSchedule(id, 'MAT 131')
    store.updateOffering(id, { prefix: 'CS', number: '101', section: 'A' }, { instructor: 'Wahl' })
    assert.equal(store.viewOfferings(store.scheduleById(id)).length, 2, 'draft stands in for the term')
    assert.equal(store.draftOperations(id).length, 2)
    assert.equal(store.publishedOfferings(store.scheduleById(id)).length, 1, 'published term untouched')

    const matRow = store.historyEntries.value.find((e) => e.label.includes('add MAT'))
    assert.ok(store.cancelChange(matRow.key))
    assert.equal(store.viewOfferings(store.scheduleById(id)).length, 1, 'the draft drops the cancelled course')
    const ops = store.draftOperations(id)
    assert.equal(ops.length, 1, 'nothing left to propose for the cancelled change')
    assert.equal(ops[0].kind, 'update')
    assert.equal(store.publishedOfferings(store.scheduleById(id)).length, 1)

    // Restore brings the change back into the draft.
    const row = store.historyEntries.value.find((e) => e.label.includes('add MAT'))
    assert.ok(store.restoreChange(row.key))
    assert.equal(store.draftOperations(id).length, 2)
    assert.equal(store.canCancel.value, true)
  })
})

test('split-section rows edit, move, and cancel independently with a single net row', async () => {
  await withRemote(async ({ store }) => {
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    // MUS 001 A meets on MW and on R at different custom times: two rows that
    // share the section tuple, exactly like the registrar's split meetings.
    const id = await store.addSchedule('Split', '2026-27', [])
    store.importCsvRows(id, [
      { prefix: 'MUS', number: '001', section: 'A', instructor: 'Smith', days: 'MW', time: '16:00-16:50', term: 'F' },
      { prefix: 'MUS', number: '001', section: 'A', instructor: 'Smith', days: 'R', time: '16:10-17:00', term: 'F' },
    ])
    const rows = () => store.viewOfferings(store.scheduleById(id))
    assert.equal(rows().length, 2)
    assert.ok(rows()[0].id && rows()[1].id, 'import fills content ids')
    assert.notEqual(rows()[0].id, rows()[1].id, 'split rows get distinct ids')

    await store.setEditingSchedule(id, 'edit')

    // Editing the R meeting changes only it; the session shows one net row.
    assert.ok(
      store.updateOffering(id, { prefix: 'MUS', number: '001', section: 'A', id: rows()[1].id }, { instructor: 'Wahl' }),
    )
    assert.equal(rows()[0].instructor, 'Smith', 'MW sibling untouched')
    assert.equal(rows()[1].instructor, 'Wahl')
    assert.equal(store.historyEntries.value.length, 1)
    assert.match(store.historyEntries.value[0].label, /MUS 001 A: instructor/)

    // Dragging the R meeting moves only it (the id rides in the drag payload);
    // still one net row for the course.
    assert.ok(
      store.moveOffering(
        id,
        'MUS',
        '001',
        'A',
        { fromDay: 'R', toDay: 'T', group: 'TR', time: '14:15-16:00' },
        false,
        0,
        rows()[1].id,
      ),
    )
    assert.equal(rows()[0].days, 'MW')
    assert.equal(rows()[1].days, 'T', 'only the dragged row moved')
    assert.equal(store.historyEntries.value.length, 1, 'move merges into the existing net row')

    // A cancel reverts the course's whole net change (instructor + move).
    const zero = (o) => `${o.instructor}|${o.days}`
    const key = store.historyEntries.value[0].key
    assert.ok(store.cancelChange(key))
    assert.deepEqual(rows().map(zero), ['Smith|MW', 'Smith|R'], 'back to the session base')
    assert.equal(store.canCancel.value, false, 'back to the session start')

    // A fresh edit re-touching the same course brings the row back to life.
    assert.ok(
      store.updateOffering(id, { prefix: 'MUS', number: '001', section: 'A', id: rows()[1].id }, { instructor: 'Doe' }),
    )
    assert.equal(store.historyEntries.value.length, 1)
    assert.equal(store.historyEntries.value[0].cancelled, false)
    assert.ok(store.cancelChange(store.historyEntries.value[0].key))
    assert.equal(rows()[1].instructor, 'Smith')
  })
})

test('history: rows expose editability and jump-to-edit opens the course editor', async () => {
  await withRemote(async ({ store }) => {
    store.setRemote(false)
    const { setApiBase } = await import('../src/backend.js')
    setApiBase('../../api')

    const id = await store.addSchedule('JumpHist', '2026-27', [])
    store.addCourseToSchedule(id, 'CS 101')
    await store.setEditingSchedule(id, 'edit')
    store.addCourseToSchedule(id, 'MAT 131')
    store.updateOffering(id, { prefix: 'CS', number: '101', section: 'A' }, { instructor: 'Wahl' })

    let rows = store.historyEntries.value
    assert.ok(rows.every((e) => e.editable), 'live add/update rows are editable right away')

    const matRow = rows.find((e) => e.label.includes('add MAT'))
    assert.ok(store.jumpToEdit(matRow.op))
    assert.equal(store.courseEditTarget.value.o.number, '131')
    assert.equal(store.courseEditTarget.value.code, 'MAT 131')
    store.closeCourseEdit()

    // Cancelling the add removes the course: the row stops being editable and
    // the editor can no longer be opened on it.
    assert.ok(store.cancelChange(matRow.key))
    rows = store.historyEntries.value
    const cancelledAdd = rows.find((e) => e.label.includes('add MAT'))
    assert.ok(cancelledAdd.cancelled)
    assert.equal(cancelledAdd.editable, false, 'course no longer exists')
    assert.equal(store.jumpToEdit(cancelledAdd.op), false)

    // A cancelled update row keeps its course in the term, so it stays editable.
    const csRow = rows.find((e) => e.label.includes('instructor'))
    assert.ok(store.cancelChange(csRow.key))
    rows = store.historyEntries.value
    const cancelledUpdate = rows.find((e) => e.label.includes('instructor'))
    assert.ok(cancelledUpdate.cancelled)
    assert.equal(cancelledUpdate.editable, true, 'course still exists -> edit still reachable')
    assert.ok(store.jumpToEdit(cancelledUpdate.op))
    assert.equal(store.courseEditTarget.value.o.prefix, 'CS')
    store.closeCourseEdit()
  })
})
