import { createRouter } from '@major-vis/router'

const routes = [
  { view: 'programs', parse: (p) => (p.length === 0 ? {} : null), href: () => '/' },
  {
    view: 'program-detail',
    parse: (p) => (p[0] === 'program' && p[1] ? { id: p[1] } : null),
    href: ({ id }) => `/program/${id}`,
  },
  {
    view: 'course-detail',
    parse: (p) => (p[0] === 'course' && p[1] ? { code: decodeURIComponent(p[1]) } : null),
    href: ({ code }) => `/course/${encodeURIComponent(code)}`,
  },
]

const router = createRouter(routes, 'programs')
export const route = router.route
export const initRouter = router.init

export function goHome() {
  router.navigate('programs')
}
export function goToProgram(id) {
  router.navigate('program-detail', { id })
}
export function goToCourse(code) {
  if (code) router.navigate('course-detail', { code })
}

// Cross-app deep link to the planner app (its own origin path + hash). The
// planner app parses `?program=&track=` on load and adds the track.
export function plannerUrl(programId, trackKey) {
  return `../planner/#/?program=${encodeURIComponent(programId)}&track=${encodeURIComponent(trackKey)}`
}
