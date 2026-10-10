// Notices when the deployment has moved past the build this page is running, so
// the app can offer a refresh. Pure JS (no Vue): the app supplies the endpoint,
// its own build id, and a callback (usually a toast).
//
// The comparison is deliberately bundle-vs-server (not a snapshot of the
// server taken at load): a stale *cached bundle* loaded after a deploy would
// record the server's new version and see no mismatch, which is exactly the
// case this exists to catch.

/**
 * @param {object} [options]
 * @param {string} [options.endpoint] the /api/version URL to poll.
 * @param {string} [options.current] this bundle's build id ('' disables).
 * @param {number} [options.intervalMs] poll cadence (default 5 min).
 * @param {typeof fetch} [options.fetchImpl]
 * @param {Document} [options.documentImpl]
 * @param {(info: { current: string, remote: string }) => void} [options.onStale]
 * @returns {{ stop: () => void, check: () => Promise<void> }}
 */
export function watchAppVersion({
  endpoint,
  current,
  intervalMs = 300000,
  fetchImpl = globalThis.fetch,
  documentImpl = globalThis.document,
  onStale,
} = {}) {
  // Nothing to compare or nowhere to ask: no-op rather than start a timer.
  if (!endpoint || !current) return { stop() {}, check: async () => {} }

  let notified = false
  let stopped = false

  async function check() {
    if (stopped || notified) return
    try {
      const res = await fetchImpl(endpoint, { cache: 'no-store' })
      if (!res || !res.ok) return
      const data = await res.json()
      const remote = data && data.commit
      if (remote && remote !== current) {
        notified = true
        if (onStale) onStale({ current, remote })
      }
    } catch {
      // Offline / no backend: try again next tick.
    }
  }

  const timer = setInterval(check, intervalMs)
  const onVisibility = () => {
    if (!documentImpl || documentImpl.visibilityState === 'visible') check()
  }
  if (documentImpl && documentImpl.addEventListener) {
    documentImpl.addEventListener('visibilitychange', onVisibility)
  }

  function stop() {
    stopped = true
    clearInterval(timer)
    if (documentImpl && documentImpl.removeEventListener) {
      documentImpl.removeEventListener('visibilitychange', onVisibility)
    }
  }

  // An immediate check catches a tab already open when a deploy lands (the
  // interval would otherwise take minutes).
  void check()

  return { stop, check }
}
