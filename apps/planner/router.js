import { createRouter } from '@major-vis/router'

const routes = [
  {
    view: 'planner',
    parse: (p, query) => (p.length === 0 ? { ...query } : null),
    href: () => '/',
  },
]

const router = createRouter(routes, 'planner')
export const route = router.route
export const initRouter = router.init

// Cross-app deep links to the browse app (its own origin path + hash).
export function browseProgramUrl(id) {
  return `../browse/#/program/${encodeURIComponent(id)}`
}
export function browseCourseUrl(code) {
  return `../browse/#/course/${encodeURIComponent(code)}`
}
