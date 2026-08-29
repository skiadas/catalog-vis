// Thin browser client for the major-vis server API. The schedule store uses this
// when the app is served by a backend (detected by an /api/config ping); when no
// server is present it falls back to the localStorage path. All functions return
// the store-facing schedule shape or null on failure, so the store can branch
// cleanly without trying to understand transport details.

// Base for API calls relative to the schedule app page (../.. -> repo root).
const API_BASE = '../../api'

export async function detectRemote() {
  try {
    const res = await fetch(`${API_BASE}/config`, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}

export async function fetchSchedules() {
  try {
    const res = await fetch(`${API_BASE}/schedules`, { method: 'GET' })
    if (!res.ok) return null
    const data = await res.json()
    return (data && data.schedules) || []
  } catch {
    return null
  }
}

export async function createSchedule({ name, year }) {
  try {
    const res = await fetch(`${API_BASE}/schedules`, {
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
    const res = await fetch(`${API_BASE}/schedules/${encodeURIComponent(id)}/terms/${term}`, {
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
    const res = await fetch(`${API_BASE}/schedules/${encodeURIComponent(id)}/terms/${term}`, {
      method: 'GET',
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data && data.term) || null
  } catch {
    return null
  }
}

// Replaces a schedule's metadata (name/status) server-side. Both fields are
// optional; a missing field is left untouched on the server.
/**
 * @param {string} id
 * @param {{ name?: string; status?: string }} meta
 */
export async function updateScheduleMeta(id, { name, status }) {
  try {
    const res = await fetch(`${API_BASE}/schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, status }),
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
    const res = await fetch(`${API_BASE}/schedules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    return res.ok
  } catch {
    return false
  }
}

// ---- Session -------------------------------------------------------------

export async function fetchSession() {
  try {
    const res = await fetch(`${API_BASE}/auth/session`, { method: 'GET' })
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
    const res = await fetch(`${API_BASE}/schedules/${encodeURIComponent(scheduleId)}/suggestions`, {
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
    const res = await fetch(`${API_BASE}/schedules/${encodeURIComponent(scheduleId)}/suggestions`, {
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

export async function approveSuggestion(id) {
  try {
    const res = await fetch(`${API_BASE}/suggestions/${encodeURIComponent(id)}/approve`, { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}

export async function rejectSuggestion(id) {
  try {
    const res = await fetch(`${API_BASE}/suggestions/${encodeURIComponent(id)}/reject`, { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}
