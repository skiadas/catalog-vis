import { createRouter } from '@major-vis/router'

const routes = [
  {
    view: 'schedule-grid',
    parse: (p) => (p.length === 0 ? { scheduleView: 'grid' } : null),
    href: () => '/',
  },
  {
    view: 'schedule-day',
    parse: (p) => (p[0] === 'day' && p[1] ? { scheduleView: 'day', day: p[1] } : null),
    href: ({ day }) => `/day/${day}`,
  },
  {
    view: 'schedule-slot',
    parse: (p) =>
      p[0] === 'slot' && p[1] && p[2]
        ? { scheduleView: 'slot', day: p[1], time: decodeURIComponent(p[2]) }
        : null,
    href: ({ day, time }) => `/slot/${day}/${encodeURIComponent(time)}`,
  },
  {
    view: 'schedule-course',
    parse: (p) =>
      p[0] === 'course' && p[1] ? { scheduleView: 'course', code: decodeURIComponent(p[1]) } : null,
    href: ({ code }) => `/course/${encodeURIComponent(code)}`,
  },
  {
    view: 'schedule-instructor',
    parse: (p) =>
      p[0] === 'instructor' && p[1]
        ? { scheduleView: 'instructor', instructor: decodeURIComponent(p[1]) }
        : null,
    href: ({ instructor }) => `/instructor/${encodeURIComponent(instructor)}`,
  },
]

const router = createRouter(routes, 'schedule-grid')
export const route = router.route
export const initRouter = router.init

export function goSchedule() {
  router.navigate('schedule-grid')
}
export function goScheduleGrid() {
  router.navigate('schedule-grid')
}
export function goScheduleDay(day) {
  router.navigate('schedule-day', { day })
}
export function goScheduleSlot(day, time) {
  router.navigate('schedule-slot', { day, time })
}
export function goScheduleCourse(code) {
  router.navigate('schedule-course', { code })
}
export function goScheduleInstructor(name) {
  router.navigate('schedule-instructor', { instructor: name })
}
