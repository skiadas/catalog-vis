// Planner app navigation: vue-router (hash history) with a single route — the
// planner renders PlannerApp via <RouterView>. The route carries no params;
// the cross-app deep link from browse arrives as the query (`?program=&track=`),
// read after the router is ready (see main.js).
import { createRouter, createWebHashHistory } from 'vue-router'
import PlannerApp from './components/PlannerApp.vue'

/** @type {import('vue-router').RouteRecordRaw[]} */
const routes = [
  { path: '/', name: 'planner', component: PlannerApp },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// Cross-app deep links to the browse app (its own origin path + hash).
export function browseProgramUrl(id) {
  return `../browse/#/program/${encodeURIComponent(id)}`
}
export function browseCourseUrl(code) {
  return `../browse/#/course/${encodeURIComponent(code)}`
}
