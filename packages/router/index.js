// Tiny hash-router factory shared by the browse, schedule, and planner apps.
//
// Each app calls `createRouter(routes, fallbackView)` with a declarative route
// table and re-exports its own navigation helpers. Routes are matched in order
// against the hash path segments (and query params); the first entry whose
// `parse` returns an object wins. `href(params)` builds the hash string (the
// part after `#`, without the leading `#`).

const { ref } = Vue

export function createRouter(routes, fallback) {
  const route = ref({ view: fallback, params: {} })

  function parseHash() {
    const hash = (window.location.hash || '#/').slice(1)
    const [pathPart, queryPart] = hash.split('?')
    const parts = pathPart.split('/').filter(Boolean)
    const query = {}
    if (queryPart) {
      for (const kv of queryPart.split('&')) {
        const [k, v] = kv.split('=')
        if (k) query[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '))
      }
    }
    for (const r of routes) {
      const params = r.parse(parts, query)
      if (params) return { view: r.view, params }
    }
    return { view: fallback, params: {} }
  }

  function handleHashChange() {
    route.value = parseHash()
  }

  function init() {
    handleHashChange()
    window.addEventListener('hashchange', handleHashChange)
  }

  function navigate(view, params = {}) {
    const r = routes.find((x) => x.view === view)
    if (!r) return
    const hash = '#' + r.href(params)
    if (window.location.hash === hash) {
      route.value = { view, params }
    } else {
      window.location.hash = hash
    }
  }

  return { route, init, navigate }
}
