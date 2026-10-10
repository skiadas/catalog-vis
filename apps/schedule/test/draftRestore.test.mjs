// Draft persistence/restore integration: a suggest session's unsent work is
// written to sessionStorage and re-based onto the server's fresh term when the
// session is re-entered — the reload path a version refresh uses. Runs under
// plain node --test against the in-process API server (see helpers.mjs).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { withRemote, flush, sessionMemory } from './helpers.mjs'

const DRAFTS_KEY = 'major-vis.schedule.drafts'

// Registrars own the schedule; a non-owner suggests. Opens the schedule and
// gives the suggester a CS department so their ops are in scope.
async function sharedSchedule(srv, store, name) {
  await srv.post('/api/auth/login', { username: 'registrar' })
  const schedule = (await srv.post('/api/schedules', { name })).json.schedule
  await srv.patch(`/api/schedules/${schedule.id}`, { visibility: 'public', suggestMode: 'public' })
  await srv.post('/api/admin/users', { username: 'phys', departments: ['CS'] })
  await srv.put(`/api/schedules/${schedule.id}/terms/F`, {
    offerings: [{ prefix: 'CS', number: '220', section: 'A', days: 'MWF', time: '9:20-10:30' }],
  })
  assert.equal(await store.signIn('phys'), true)
  return schedule
}

// Simulates a page reload: drop the in-memory session/drafts, then run the
// boot-time restore from the persisted payload.
function simulateReload(store) {
  store.pendingDrafts.value = {}
  store.editingScheduleId.value = null
  store.editingRole.value = null
  store.restoreStoredDrafts()
}

test('an unsent suggest draft survives a reload and re-bases onto the fresh term', async () => {
  await withRemote(
    async ({ srv, store }) => {
      const schedule = await sharedSchedule(srv, store, 'Restore')

      assert.equal(await store.setEditingSchedule(schedule.id, 'suggest'), true)
      store.addCourseToSchedule(schedule.id, 'CS 101')
      store.flushDrafts()
      assert.ok(sessionMemory.has(DRAFTS_KEY), 'draft persisted')

      simulateReload(store)
      assert.equal(store.restoredNotice.value, true, 'recovery signalled')
      assert.equal(await store.setEditingSchedule(schedule.id, 'suggest'), true)

      const draft = store.viewOfferings(store.scheduleById(schedule.id))
      assert.equal(draft.filter((o) => `${o.prefix} ${o.number}` === 'CS 101').length, 1)
      assert.equal(store.draftUnsentOperations(schedule.id).length, 1, 'still unsent')
    },
    { adminUsernames: new Set(['registrar']) },
  )
})

test('every dirty term draft comes back, not just the active one', async () => {
  await withRemote(
    async ({ srv, store }) => {
      const schedule = await sharedSchedule(srv, store, 'Restore two terms')

      assert.equal(await store.setEditingSchedule(schedule.id, 'suggest'), true)
      store.addCourseToSchedule(schedule.id, 'CS 101') // Fall
      store.activeTerm.value = 'W'
      await flush()
      store.addCourseToSchedule(schedule.id, 'CS 102') // Winter
      store.flushDrafts()
      assert.ok(sessionMemory.has(DRAFTS_KEY))

      simulateReload(store)
      // Re-enter on Winter (the active term at reload), then cross to Fall.
      assert.equal(await store.setEditingSchedule(schedule.id, 'suggest'), true)
      let draft = store.viewOfferings(store.scheduleById(schedule.id))
      assert.equal(draft.some((o) => `${o.prefix} ${o.number}` === 'CS 102'), true)
      store.activeTerm.value = 'F'
      await flush()
      draft = store.viewOfferings(store.scheduleById(schedule.id))
      assert.equal(draft.some((o) => `${o.prefix} ${o.number}` === 'CS 101'), true)
    },
    { adminUsernames: new Set(['registrar']) },
  )
})

test('a successful proposal clears the stored draft', async () => {
  await withRemote(
    async ({ srv, store }) => {
      const schedule = await sharedSchedule(srv, store, 'Restore clears')

      assert.equal(await store.setEditingSchedule(schedule.id, 'suggest'), true)
      store.addCourseToSchedule(schedule.id, 'CS 101')
      store.flushDrafts()
      assert.ok(sessionMemory.has(DRAFTS_KEY))

      assert.ok(await store.proposeDraft(schedule.id, ''))
      assert.equal(sessionMemory.has(DRAFTS_KEY), false, 'clean draft no longer stored')
    },
    { adminUsernames: new Set(['registrar']) },
  )
})
