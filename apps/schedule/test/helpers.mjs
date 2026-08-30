// Shared harness for the schedule store tests: an in-process API server (the
// same helpers the server suite uses) plus a localStorage shim and a cookie-
// aware fetch, so the store runs under plain `node --test` against a real
// backend. `window` is shimmed before the store module loads (guarded
// localStorage reads then work; the store itself never touches the DOM).

import { openDb } from '../../../server/src/db.js'
import { createApp } from '../../../server/src/app.js'
import { startTestServer } from '../../../server/test/helpers.mjs'

const memoryStorage = new Map()

// Minimal `Storage`-shaped shim (the store reads localStorage behind
// window-guards; node only provides the real thing behind a flag).
const shim = {
  get length() {
    return memoryStorage.size
  },
  clear: () => memoryStorage.clear(),
  key: (i) => Array.from(memoryStorage.keys())[i] ?? null,
  getItem: (k) => (memoryStorage.has(k) ? memoryStorage.get(k) : null),
  setItem: (k, v) => memoryStorage.set(k, String(v)),
  removeItem: (k) => memoryStorage.delete(k),
}

globalThis.window = /** @type {Window & typeof globalThis} */ (
  /** @type {unknown} */ ({ confirm: () => true, localStorage: shim })
)
// The store reads the bare `localStorage` global (what browsers expose);
// Node only provides it behind a flag, so shim it directly.
globalThis.localStorage = /** @type {Storage} */ (/** @type {unknown} */ (shim))

// A fetch that keeps the session cookie for the STORE's calls (which behave
// like a browser). Real HTTP to the in-process server; only cookie plumbing is
// shimmed. Requests that already carry a Cookie header (the API-client
// helpers) are passed through untouched — this wrapper must not clobber them.
export function installCookieFetch() {
  const prev = globalThis.fetch
  const realFetch = prev
  let jar = ''
  globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers)
    const ownsSession = !headers.has('Cookie')
    if (ownsSession && jar) headers.set('Cookie', jar)
    const res = await realFetch(url, { ...init, headers })
    if (!ownsSession) return res
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
    for (const sc of setCookies) {
      const [pair] = sc.split(';')
      const idx = pair.indexOf('=')
      if (idx > 0) jar = `${pair.slice(0, idx).trim()}=${pair.slice(idx + 1)}`
    }
    return res
  }
  return prev
}

// An in-memory API server with a cookie-aware store fetch, remote mode on.
export async function withRemote(fn) {
  const database = await openDb(':memory:')
  const app = createApp({ database, services: ['schedule'] })
  const srv = await startTestServer(app)
  // Static imports of the store would evaluate before the shims; load it after
  // the environment is ready.
  const store = await import('../src/scheduleStore.js')
  const { setApiBase } = await import('../src/backend.js')
  setApiBase(srv.base + '/api')
  const prevFetch = installCookieFetch()
  store.setRemote(true)
  try {
    return await fn({ srv, base: srv.base, store })
  } finally {
    store.setRemote(false)
    resetStore(store)
    globalThis.fetch = prevFetch
    await srv.close()
    database.close()
  }
}

// Resets module state between tests (each node --test file runs in its own
// process, but tests within a file share the module singletons).
export function resetStore(store) {
  store.schedules.value = []
  store.selectedScheduleIds.value = []
  store.activeTerm.value = 'F'
  store.editingScheduleId.value = null
  store.editingRole.value = null
  store.currentUser.value = null
  store.pendingDrafts.value = {}
  store.suggestionsBySchedule.value = {}
  store.setShowPendingSuggestions(true)
  memoryStorage.clear()
}

// Lets in-flight promise chains (draft setup, fire-and-forget term syncs)
// settle.
export const flush = () => new Promise((r) => setTimeout(r, 30))

// Waits until `pred` is truthy (capped), throwing otherwise.
export async function waitFor(pred, timeout = 3000) {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}
