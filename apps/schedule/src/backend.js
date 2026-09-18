// Thin browser client for the major-vis server API. The schedule store uses this
// when the app is served by a backend (detected by an /api/config ping); when no
// server is present it falls back to the localStorage path. All functions return
// the store-facing schedule shape or null on failure, so the store can branch
// cleanly without trying to understand transport details.

// Base for API calls (../.. -> repo root in the served layout). Mutable so
// tests can point the store at an in-process server; the store's functions read
// the current value at call time.
export let apiBase = '../../api'

// Overrides the API base (used by the store test suite; also a deploy seam).
export function setApiBase(base) {
  apiBase = base
}

// Fetches the server's config advertisement ({ services, auth }), or null when
// no backend is serving this app. `auth.provider` tells the store whether
// sign-in is username self-identify or an OIDC redirect.
export async function fetchConfig() {
  try {
    const res = await fetch(`${apiBase}/config`, { method: 'GET' })
    if (!res.ok) return null
    const data = await res.json()
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

export async function detectRemote() {
  return (await fetchConfig()) !== null
}

export async function fetchSchedules() {
  try {
    const res = await fetch(`${apiBase}/schedules`, { method: 'GET' })
    if (!res.ok) return null
    const data = await res.json()
    return (data && data.schedules) || []
  } catch {
    return null
  }
}

export async function createSchedule({ name, year }) {
  try {
    const res = await fetch(`${apiBase}/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, year }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data && data.schedule) || null
  } catch {
    return null
  }
}

// Replaces a term part's offerings with `offerings` (returns true on success).
// Ownership is enforced server-side; a caller hitting a 403 stays on the local
// optimistic view, which is resolved on the next full reload.
export async function replaceTerm(id, term, offerings) {
  try {
    const res = await fetch(`${apiBase}/schedules/${encodeURIComponent(id)}/terms/${term}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerings }),
    })
    return res.ok
  } catch {
    return false
  }
}

// Fetches a term part ({ offerings, version }) or null.
export async function fetchTerm(id, term) {
  try {
    const res = await fetch(`${apiBase}/schedules/${encodeURIComponent(id)}/terms/${term}`, {
      method: 'GET',
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data && data.term) || null
  } catch {
    return null
  }
}

// Replaces a schedule's metadata (name/status/access) server-side. All fields
// are optional; a missing field is left untouched on the server. `viewers` /
// `suggesters` are username lists; the server canonicalizes them and returns
// the stored form in the schedule row.
/**
 * @param {string} id
 * @param {{
 *   name?: string;
 *   status?: string;
 *   visibility?: 'private' | 'shared' | 'public';
 *   suggestMode?: 'owner' | 'shared' | 'public';
 *   viewers?: string[];
 *   suggesters?: string[];
 * }} meta
 */
export async function updateScheduleMeta(id, { name, status, visibility, suggestMode, viewers, suggesters }) {
  try {
    const res = await fetch(`${apiBase}/schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, status, visibility, suggestMode, viewers, suggesters }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data && data.schedule) || null
  } catch {
    return null
  }
}

export async function deleteSchedule(id) {
  try {
    const res = await fetch(`${apiBase}/schedules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    return res.ok
  } catch {
    return false
  }
}

// ---- Session -------------------------------------------------------------

// URL that starts the OIDC login dance: the server redirects to the issuer and
// back to `returnTo` (an app path the server validates as same-origin).
export function ssoLoginUrl(returnTo) {
  const url = `${apiBase}/auth/login`
  return returnTo ? `${url}?return_to=${encodeURIComponent(returnTo)}` : url
}

// Signs in with a username (self-identify). Returns the user or null.
export async function login(username) {
  try {
    const res = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data && data.user) || null
  } catch {
    return null
  }
}

export async function logout() {
  try {
    const res = await fetch(`${apiBase}/auth/logout`, { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}

export async function fetchSession() {
  try {
    const res = await fetch(`${apiBase}/auth/session`, { method: 'GET' })
    if (!res.ok) return null
    const data = await res.json()
    return (data && data.user) || null
  } catch {
    return null
  }
}

// ---- Suggested changes ---------------------------------------------------

export async function fetchSuggestions(scheduleId) {
  try {
    const res = await fetch(`${apiBase}/schedules/${encodeURIComponent(scheduleId)}/suggestions`, {
      method: 'GET',
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data && data.suggestions) || []
  } catch {
    return []
  }
}

// Submits a suggested change for a term. `payload` = { term, baseVersion,
// operations, note }. Operations come from `@major-vis/schedule-core/diff`'s
// `diffOfferings` (add/remove/update with per-field diff). Returns the created
// suggestion or null.
export async function createSuggestion(scheduleId, payload) {
  try {
    const res = await fetch(`${apiBase}/schedules/${encodeURIComponent(scheduleId)}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data && data.suggestion) || null
  } catch {
    return null
  }
}

// Resolves one operation (`opId`) of a pending suggestion. Approving returns
// the server's { term, suggestion } — the term is the published state with that
// one op applied — and rejecting returns the updated suggestion. Both are null
// when the request failed (not pending, already resolved, bad opId, ...).
export async function approveSuggestion(id, opId) {
  try {
    const res = await fetch(`${apiBase}/suggestions/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opId }),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function rejectSuggestion(id, opId) {
  try {
    const res = await fetch(`${apiBase}/suggestions/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opId }),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// Replaces a pending suggestion's operations and/or note (own proposals only).
// Returns the updated suggestion or null.
export async function updateSuggestion(id, payload) {
  try {
    const res = await fetch(`${apiBase}/suggestions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data && data.suggestion) || null
  } catch {
    return null
  }
}

// Withdraws the proposer's own pending change(s): one op when `opId` is given,
// else every remaining pending op of the suggestion. Returns the updated
// suggestion or null.
export async function withdrawSuggestion(id, opId) {
  try {
    const res = await fetch(`${apiBase}/suggestions/${encodeURIComponent(id)}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opId != null ? { opId } : {}),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data && data.suggestion) || null
  } catch {
    return null
  }
}
