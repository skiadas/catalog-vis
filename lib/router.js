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
