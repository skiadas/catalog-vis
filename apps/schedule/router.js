// Schedule app navigation: vue-router (hash history) with declarative routes.
// Every route renders the same ScheduleApp shell (via <RouterView>);
// `meta.scheduleView` picks the sub-view (grid/day/slot/course/instructor)
// exactly like the old `params.scheduleView` discriminator, keeping deep
// links unchanged. `meta.page` turns the shell into a standalone page
// (`/schedules` is the "Your schedules" management surface, a page rather
// than the modal it grew out of).
//
// The edit/suggest *session* rides in the query (`?mode=edit&id=3`) rather
// than the path: it is orthogonal to the view, so every view route keeps its
// own params and the session survives switching grid/day/slot/… — and stays
// deep-linkable.
import { createRouter, createWebHashHistory } from 'vue-router'
import ScheduleApp from './components/ScheduleApp.vue'
import AdminPage from './components/AdminPage.vue'
import { editingDraft, editingScheduleId, clearDraft, activeTerm } from './src/scheduleStore.js'

/** @type {import('vue-router').RouteRecordRaw[]} */
const routes = [
  { path: '/', name: 'schedule-grid', component: ScheduleApp, meta: { scheduleView: 'grid' } },
  {
    path: '/schedules',
    name: 'schedule-manage',
    component: ScheduleApp,
    meta: { page: 'manage' },
  },
  {
    path: '/schedule/:id/access',
    name: 'schedule-access',
    component: ScheduleApp,
    meta: { overlay: 'access' },
  },
  {
    path: '/schedule/:id/proposals',
    name: 'schedule-proposals',
    component: ScheduleApp,
    meta: { overlay: 'proposals' },
  },
  {
    // `:offeringCode`, not `:code`: the course *view* route already owns
    // `route.params.code`, and the underlay it renders while this overlay is
    // open must keep reading its own course.
    path: '/schedule/:id/course/:offeringCode/edit',
    name: 'schedule-course-edit',
    component: ScheduleApp,
    meta: { overlay: 'course-edit' },
  },
  {
    path: '/admin',
    name: 'admin',
    component: AdminPage,
  },
  { path: '/day/:day', name: 'schedule-day', component: ScheduleApp, meta: { scheduleView: 'day' } },
  {
    path: '/slot/:day/:time',
    name: 'schedule-slot',
    component: ScheduleApp,
    meta: { scheduleView: 'slot' },
  },
  {
    path: '/course/:code',
    name: 'schedule-course',
    component: ScheduleApp,
    meta: { scheduleView: 'course' },
  },
  {
    path: '/instructor/:instructor',
    name: 'schedule-instructor',
    component: ScheduleApp,
    meta: { scheduleView: 'instructor' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// The active session's `{ mode, id }`, or null. While one is active, in-app
// view navigation carries it along and *replaces* the current history entry —
// so the browser back button leaves the session (rather than walking back
// through the views you visited while editing).
function modeQuery() {
  const q = router.currentRoute.value.query
  return (q.mode === 'edit' || q.mode === 'suggest') && q.id != null ? { mode: q.mode, id: q.id } : null
}
function go(location) {
  const mode = modeQuery()
  if (mode) router.replace({ ...location, query: { ...location.query, ...mode } })
  else router.push(location)
}
export function goSchedule() {
  go({ name: 'schedule-grid' })
}
export function goScheduleGrid() {
  go({ name: 'schedule-grid' })
}
export function goScheduleDay(day) {
  go({ name: 'schedule-day', params: { day } })
}
export function goScheduleSlot(day, time) {
  if (time) go({ name: 'schedule-slot', params: { day, time } })
}
export function goScheduleCourse(code) {
  go({ name: 'schedule-course', params: { code } })
}
export function goScheduleInstructor(name) {
  go({ name: 'schedule-instructor', params: { instructor: name } })
}
export function goManage() {
  // Already there (the picker button stays visible on the page): a duplicate
  // push would be a rejected navigation, not a new history entry.
  if (router.currentRoute.value.name === 'schedule-manage') return
  router.push({ name: 'schedule-manage' })
}
export function goAccess(id) {
  router.push({ name: 'schedule-access', params: { id: String(id) } })
}
export function goProposals(id) {
  router.push({ name: 'schedule-proposals', params: { id: String(id) } })
}
// Opens the course editor overlay. The route names the course (its base code);
// the editor's section switcher covers the rest of the sections and labs.
export function goCourseEdit(id, code) {
  router.push({ name: 'schedule-course-edit', params: { id: String(id), offeringCode: String(code) } })
}
// Enters an edit/suggest session. From a schedule view the view is kept (you
// edit the day/grid you were looking at); from a page or overlay it starts on
// the grid.
export function goMode(id, role = 'edit') {
  const cur = router.currentRoute.value
  const onView = cur.meta.scheduleView && !cur.meta.page && !cur.meta.overlay
  const base = onView ? { name: cur.name, params: { ...cur.params } } : { name: 'schedule-grid' }
  router.push({ ...base, query: { mode: role === 'suggest' ? 'suggest' : 'edit', id: String(id) } })
}
// Leaves the session, staying on the current view (strips the mode query).
export function exitMode() {
  const q = { ...router.currentRoute.value.query }
  delete q.mode
  delete q.id
  router.replace({ query: q })
}
// Leaves a full-page or overlay route (e.g. `/schedules`, `.../access`):
// browser history is the intended close, but a deep link has nothing to go
// back to in-app, so fall back to the grid rather than leaving the app.
export function goBackOrGrid() {
  if (window.history.state && window.history.state.back) router.back()
  else router.push({ name: 'schedule-grid' })
}

// Leaving a session with an unsaved suggest draft always asks first — however
// you leave (Done, browser back, a header link). A clean session just ends;
// the draft itself persists in the store, so a declined exit keeps you put.
// Overlay routes (access/proposals/course editor) are session-transparent:
// opening one is not leaving, so it never asks.
router.beforeEach((to, from) => {
  const mode = from.query.mode
  const leavingMode = (mode === 'edit' || mode === 'suggest') && to.query.mode !== mode && !to.meta.overlay
  if (!leavingMode) return true
  const draft = editingDraft.value
  if (draft && draft.dirty) {
    if (!window.confirm('Discard your unsaved draft changes?')) return false
    clearDraft(editingScheduleId.value, activeTerm.value)
  }
  return true
})
