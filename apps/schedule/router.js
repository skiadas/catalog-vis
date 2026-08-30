// Schedule app navigation: vue-router (hash history) with declarative routes.
// Every route renders the same ScheduleApp shell (via <RouterView>);
// `meta.scheduleView` picks the sub-view (grid/day/slot/course/instructor)
// exactly like the old `params.scheduleView` discriminator, keeping deep
// links unchanged.
import { createRouter, createWebHashHistory } from 'vue-router'
import ScheduleApp from './components/ScheduleApp.vue'

/** @type {import('vue-router').RouteRecordRaw[]} */
const routes = [
  { path: '/', name: 'schedule-grid', component: ScheduleApp, meta: { scheduleView: 'grid' } },
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
