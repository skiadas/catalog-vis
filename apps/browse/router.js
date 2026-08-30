// Browse app navigation: vue-router (hash history) with declarative routes.
// View components are attached per route; the root App.vue renders them via
// <RouterView>. Keeps `go*` helpers as the single place that knows what links
// exist (course chips, program cards navigate programmatically).
import { createRouter, createWebHashHistory } from 'vue-router'
import ProgramList from './components/ProgramList.vue'
import ProgramDetail from './components/ProgramDetail.vue'
import CourseDetail from './components/CourseDetail.vue'

/** @type {import('vue-router').RouteRecordRaw[]} */
const routes = [
  { path: '/', name: 'programs', component: ProgramList },
  { path: '/program/:id', name: 'program-detail', component: ProgramDetail },
  { path: '/course/:code', name: 'course-detail', component: CourseDetail },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export function goHome() {
  router.push({ name: 'programs' })
}
export function goToProgram(id) {
  router.push({ name: 'program-detail', params: { id } })
}
export function goToCourse(code) {
  if (code) router.push({ name: 'course-detail', params: { code } })
}

// Cross-app deep link to the planner app (its own origin path + hash). The
// planner app parses `?program=&track=` on load and adds the track.
export function plannerUrl(programId, trackKey) {
  return `../planner/#/?program=${encodeURIComponent(programId)}&track=${encodeURIComponent(trackKey)}`
}
