// Persists a suggest session's *unsent* work so a reload (e.g. to pick up a new
// deployment) doesn't lose it, and lets the store re-base it onto the server's
// fresh state when the session is re-entered.
//
// Only the unsent operations are stored — the diff from a draft's `baseline` to
// its current `offerings` — not the absolute end-state. On restore they re-apply
// onto the freshly fetched published term (plus the proposer's own pending
// replay), so a term that moved under the draft is handled correctly. Clean
// drafts are dropped: `setupDraft` rebuilds those from the server anyway.
//
// Pure: the storage object and the data are injected, so this is node-testable
// and free of DOM/Vue coupling.

import { diffOfferings } from '@major-vis/schedule-core/diff'

export const DRAFTS_KEY = 'major-vis.schedule.drafts'

// The restorable payload for the given drafts map (keyed `${scheduleId}:${term}`),
// or null when there is nothing unsent to keep. `user`/`appVersion` are stamped
// so a different identity never restores someone else's work and a future
// shape change is detectable.
/**
 * @param {Record<string, any>} drafts
 * @param {{ user?: string|number, appVersion?: string }} [meta]
 */
export function collectRestorable(drafts, { user, appVersion } = {}) {
  const out = []
  for (const [draftKey, d] of Object.entries(drafts || {})) {
    if (!d || !d.dirty) continue
    const sep = draftKey.indexOf(':')
    if (sep < 0) continue
    const scheduleId = draftKey.slice(0, sep)
    const term = draftKey.slice(sep + 1)
    const operations = diffOfferings(d.baseline || [], d.offerings || [])
    if (!operations.length) continue
    out.push({ scheduleId, term, operations })
  }
  if (!out.length) return null
  return { user: String(user ?? ''), appVersion: String(appVersion ?? ''), drafts: out }
}

// Parses a stored payload into restorable entries. `resolveScheduleId(storedId)`
// maps the stored (string) id back to a live schedule id, or null when that
// schedule is gone (its draft is then dropped). Wrong-user, malformed, and
// empty payloads yield [].
/**
 * @param {string|null} raw
 * @param {{ user?: string|number, resolveScheduleId?: (id: string) => any }} [options]
 */
export function readRestorable(raw, { user, resolveScheduleId } = {}) {
  let data
  try {
    data = JSON.parse(raw || '')
  } catch {
    return []
  }
  if (!data || typeof data !== 'object') return []
  if (String(data.user) !== String(user ?? '')) return []
  const out = []
  for (const d of Array.isArray(data.drafts) ? data.drafts : []) {
    if (!d || !Array.isArray(d.operations) || !d.operations.length) continue
    const id = resolveScheduleId ? resolveScheduleId(d.scheduleId) : d.scheduleId
    if (id == null) continue
    out.push({ scheduleId: id, term: d.term, operations: d.operations })
  }
  return out
}

// Reads the raw payload from a Storage-like object, or null. Failures (private
// mode, storage disabled) are silent.
export function readDrafts(storage) {
  if (!storage) return null
  try {
    return storage.getItem(DRAFTS_KEY)
  } catch {
    return null
  }
}

// Writes (or, for a null payload, removes) the stored payload. Silent on
// failure — persistence is best-effort, never a reason to break an edit.
export function writeDrafts(storage, payload) {
  if (!storage) return
  try {
    if (!payload) storage.removeItem(DRAFTS_KEY)
    else storage.setItem(DRAFTS_KEY, JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}
