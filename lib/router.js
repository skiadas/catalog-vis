const { ref } = Vue

export const route = ref({ view: 'programs', params: {} })

function parseHash() {
  const hash = window.location.hash.slice(1) || '/'
  const parts = hash.split('/').filter(Boolean)
  if (parts[0] === 'program' && parts[1]) {
    return { view: 'program-detail', params: { id: parts[1] } }
  }
  if (parts[0] === 'course' && parts[1]) {
    return { view: 'course-detail', params: { code: decodeURIComponent(parts[1]) } }
  }
  if (parts[0] === 'schedule') {
    const view = parts[1]
    if (view === 'day' && parts[2]) {
      return { view: 'schedule', params: { scheduleView: 'day', day: parts[2] } }
    }
    if (view === 'slot' && parts[2] && parts[3]) {
      return {
        view: 'schedule',
        params: { scheduleView: 'slot', day: parts[2], time: decodeURIComponent(parts[3]) },
      }
    }
    if (view === 'course' && parts[2]) {
      return { view: 'schedule', params: { scheduleView: 'course', code: decodeURIComponent(parts[2]) } }
    }
    if (view === 'instructor' && parts[2]) {
      return {
        view: 'schedule',
        params: { scheduleView: 'instructor', instructor: decodeURIComponent(parts[2]) },
      }
    }
    return { view: 'schedule', params: { scheduleView: 'grid' } }
  }
  return { view: 'programs', params: {} }
}

function handleHashChange() {
  route.value = parseHash()
}

export function initRouter() {
  handleHashChange()
  window.addEventListener('hashchange', handleHashChange)
}

export function navigate(view, params = {}) {
  let hash = ''
  if (view === 'programs') hash = '#/'
  else if (view === 'program-detail') hash = '#/program/' + params.id
  else if (view === 'course-detail') hash = '#/course/' + encodeURIComponent(params.code)
  else if (view === 'schedule') {
    hash = '#/schedule'
    if (params.scheduleView === 'day') hash = '#/schedule/day/' + params.day
    else if (params.scheduleView === 'slot')
      hash = '#/schedule/slot/' + params.day + '/' + encodeURIComponent(params.time)
    else if (params.scheduleView === 'course') hash = '#/schedule/course/' + encodeURIComponent(params.code)
    else if (params.scheduleView === 'instructor')
      hash = '#/schedule/instructor/' + encodeURIComponent(params.instructor)
  }
  window.location.hash = hash
}

export function goToProgram(id) {
  navigate('program-detail', { id })
}

export function goToCourse(code) {
  if (code) navigate('course-detail', { code })
}

export function goHome() {
  navigate('programs')
}

export function goSchedule() {
  navigate('schedule', { scheduleView: 'grid' })
}

export function goScheduleGrid() {
  navigate('schedule', { scheduleView: 'grid' })
}

export function goScheduleDay(day) {
  navigate('schedule', { scheduleView: 'day', day })
}

export function goScheduleSlot(day, time) {
  navigate('schedule', { scheduleView: 'slot', day, time })
}

export function goScheduleCourse(code) {
  navigate('schedule', { scheduleView: 'course', code })
}

export function goScheduleInstructor(name) {
  navigate('schedule', { scheduleView: 'instructor', instructor: name })
}
