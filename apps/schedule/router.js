// Schedule app navigation: vue-router (hash history) with declarative routes.
// Every route renders the same ScheduleApp shell (via <RouterView>);
// `meta.scheduleView` picks the sub-view (grid/day/slot/course/instructor)
// exactly like the old `params.scheduleView` discriminator, keeping deep
// links unchanged. `meta.page` turns the shell into a standalone page
// (`/schedules` is the "Your schedules" management surface, a page rather
// than the modal it grew out of).
import { createRouter, createWebHashHistory } from 'vue-router'
import ScheduleApp from './components/ScheduleApp.vue'
import AdminPage from './components/AdminPage.vue'

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

export function goSchedule() {
  router.push({ name: 'schedule-grid' })
}
export function goScheduleGrid() {
  router.push({ name: 'schedule-grid' })
}
export function goScheduleDay(day) {
  router.push({ name: 'schedule-day', params: { day } })
}
export function goScheduleSlot(day, time) {
  if (time) router.push({ name: 'schedule-slot', params: { day, time } })
}
export function goScheduleCourse(code) {
  router.push({ name: 'schedule-course', params: { code } })
}
export function goScheduleInstructor(name) {
  router.push({ name: 'schedule-instructor', params: { instructor: name } })
}
export function goManage() {
  // Already there (the picker button stays visible on the page): a duplicate
  // push would be a rejected navigation, not a new history entry.
  if (router.currentRoute.value.name === 'schedule-manage') return
  router.push({ name: 'schedule-manage' })
}
// Leaves a full-page route (e.g. `/schedules`): browser history is the
// intended close, but a deep link has nothing to go back to in-app, so fall
// back to the grid rather than leaving the app.
export function goBackOrSchedule() {
  if (window.history.state && window.history.state.back) router.back()
  else router.push({ name: 'schedule-grid' })
}
