// Cross-listed group behavior in the schedule store: creating/attaching
// versions, the owner's cascading edits, the first-edit ownership claim,
// removal semantics, and materializing missing versions. Runs offline against
// the store's localStorage shim (the catalog is stubbed by setting the
// catalog-client `crossListings` ref directly).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { crossListings } from '@major-vis/catalog-client'
import { resetStore } from './helpers.mjs'

// Imported after helpers.mjs installs the window/localStorage shims.
const store = await import('../src/scheduleStore.js')

const GROUP = { id: 'cs-263-engr-263', codes: ['CS 263', 'ENGR 263'] }

const offering = (fields) => ({
  prefix: 'CS',
  number: '263',
  section: 'A',
  title: '',
  instructor: '',
  secondaryInstructors: [],
  days: 'MWF',
  time: '9:20-10:30',
  seats: 24,
  ...fields,
})

function install(offerings = [], { remote = false } = {}) {
  resetStore(store)
  crossListings.value = [GROUP]
  store.setRemote(remote)
  const schedule = {
    id: 's1',
    name: 'Test',
    year: '2026',
    owner_user_id: 1,
    terms: {
      F: { offerings, version: 0 },
      W: { offerings: [], version: 0 },
      S: { offerings: [], version: 0 },
    },
  }
  store.schedules.value = [schedule]
  store.selectedScheduleIds.value = ['s1']
  store.activeTerm.value = 'F'
  if (remote) {
    store.currentUser.value = { id: 2, username: 'user', departments: ['ENGR'] }
    store.editingScheduleId.value = 's1'
    store.editingRole.value = 'suggest'
  }
  return schedule
}

const term = () => store.schedules.value[0].terms.F.offerings
const row = (prefix, number) => term().find((o) => o.prefix === prefix && o.number === number)

test.afterEach(() => {
  crossListings.value = []
  resetStore(store)
})

test('the first version created owns the cross-list group', () => {
  install([])
  const item = store.addCourseToSchedule('s1', 'CS 263')
  assert.equal(item.o.crossListOwner, 'CS')
  assert.equal(term().length, 1)
})

test('adding the other version attaches to the group and copies its fields', () => {
  install([
    offering({
      prefix: 'ENGR',
      crossListOwner: 'ENGR',
      section: 'A',
      instructor: 'Wahl',
      days: 'TR',
      time: '10:00-11:45',
      seats: 30,
    }),
  ])
  const item = store.addCourseToSchedule('s1', 'CS 263')
  assert.equal(item.o.section, 'A', 'adopts the existing version section when free')
  assert.equal(item.o.crossListOwner, 'ENGR', 'joins the existing owner')
  assert.equal(item.o.instructor, 'Wahl')
  assert.equal(item.o.days, 'TR')
  assert.equal(item.o.time, '10:00-11:45')
  assert.equal(item.o.seats, 30)
})

test("the owner's edit cascades to every version", () => {
  install([
    offering({ prefix: 'CS', crossListOwner: 'CS', instructor: 'Wahl' }),
    offering({ prefix: 'ENGR', crossListOwner: 'CS', instructor: 'Wahl' }),
  ])
  const ok = store.updateOffering(
    's1',
    { prefix: 'CS', number: '263', section: 'A' },
    { time: '13:20-14:30', instructor: 'Skiadas' },
  )
  assert.equal(ok, true)
  for (const o of term()) {
    assert.equal(o.time, '13:20-14:30', o.prefix)
    assert.equal(o.instructor, 'Skiadas', o.prefix)
  }
})

test('the first edit claims an unowned imported group', () => {
  install([
    offering({ prefix: 'CS', section: 'A' }),
    offering({ prefix: 'ENGR', section: 'A' }),
  ])
  store.updateOffering('s1', { prefix: 'ENGR', number: '263', section: 'A' }, { time: '8:00-9:10' })
  assert.equal(row('ENGR', '263').crossListOwner, 'ENGR')
  assert.equal(row('CS', '263').crossListOwner, 'ENGR', 'the claim covers the whole group')
  assert.equal(row('CS', '263').time, '8:00-9:10', 'and the edit cascades')
})

test("removing the owner's version removes the whole group (and its labs)", () => {
  install([
    offering({ prefix: 'CS', crossListOwner: 'ENGR' }),
    offering({ prefix: 'ENGR', crossListOwner: 'ENGR' }),
    offering({ prefix: 'ENGR', lab: true, labSeq: 1, section: 'A' }),
    offering({ prefix: 'BIO', number: '161', section: 'A' }),
  ])
  store.removeCourseFromSchedule('s1', { prefix: 'ENGR', number: '263', section: 'A' })
  assert.deepEqual(
    term().map((o) => `${o.prefix} ${o.number}`),
    ['BIO 161'],
    'the group versions and the ENGR lab go; the unrelated course stays',
  )
})

test('a member removing a version that is not the owner row leaves the rest', () => {
  install([
    offering({ prefix: 'CS', crossListOwner: 'CS' }),
    offering({ prefix: 'ENGR', crossListOwner: 'CS' }),
  ])
  store.removeCourseFromSchedule('s1', { prefix: 'ENGR', number: '263', section: 'A' })
  assert.deepEqual(
    term().map((o) => o.prefix),
    ['CS'],
  )
})

test('materializing versions copies the source fields, section, and labs', () => {
  install([
    offering({ prefix: 'CS', crossListOwner: 'CS', instructor: 'Wahl', time: '13:20-14:30' }),
    offering({ prefix: 'CS', lab: true, labSeq: 1, section: 'A', days: 'T', time: '14:00-16:00' }),
  ])
  const created = store.materializeCrossListVersions('s1', {
    prefix: 'CS',
    number: '263',
    section: 'A',
  })
  assert.equal(created.length, 1)
  const engr = row('ENGR', '263')
  assert.equal(engr.section, 'A')
  assert.equal(engr.instructor, 'Wahl')
  assert.equal(engr.time, '13:20-14:30')
  assert.equal(engr.crossListOwner, 'CS')
  const lab = term().find((o) => o.prefix === 'ENGR' && o.lab)
  assert.ok(lab, 'the source lab is copied to the new version')
  assert.equal(lab.section, 'A')
  assert.equal(lab.time, '14:00-16:00')
})

test('crossListState reports the other codes, present versions, and owner', () => {
  install([
    offering({ prefix: 'CS', crossListOwner: 'CS' }),
  ])
  const state = store.crossListState('s1', { prefix: 'CS', number: '263', section: 'A' })
  assert.equal(state.crossListed, true)
  assert.deepEqual(state.otherCodes, ['ENGR 263'])
  assert.deepEqual(state.present, [])
  assert.deepEqual(state.missing, ['ENGR 263'])
  assert.equal(state.owner, 'CS')
})

test('permission: the group owner may edit any version; a member only removes its own', () => {
  install([offering({ prefix: 'CS', crossListOwner: 'ENGR' })], { remote: true })
  // The signed-in user is in ENGR (see install).
  assert.equal(store.canTouchOffering('s1', { prefix: 'CS', crossListOwner: 'ENGR' }, 'edit'), true)
  assert.equal(store.canTouchOffering('s1', { prefix: 'CS', crossListOwner: 'CS' }, 'edit'), false)
  assert.equal(store.canTouchOffering('s1', { prefix: 'CS', crossListOwner: 'CS' }, 'remove'), false)
  assert.equal(store.canTouchOffering('s1', { prefix: 'ENGR', crossListOwner: 'CS' }, 'remove'), true)
})

test('imported rows are unowned and their cross_listed claim is not stored', () => {
  install([])
  store.importCsvRows('s1', [
    { prefix: 'CS', number: '263', section: 'A', term: 'F', crossListed: ['ENGR'], days: 'MWF', time: '9:20-10:30' },
  ])
  const [o] = term()
  assert.equal(o.crossListed, undefined, 'the sheet claim is stripped')
  assert.equal(o.crossListOwner, undefined, 'an imported group starts unowned')
})
