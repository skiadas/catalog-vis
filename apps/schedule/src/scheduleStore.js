// Schedule app store: the schedule collection, the active term, display filters,
// generation, and editing state. Persists to localStorage (`major-vis.schedule.*`)
// and depends on the catalog data layer (`@major-vis/catalog-client`) for course
// names and faculty pools (generation) and `@major-vis/schedule-core` for the
// term slot model and domain helpers.
//
// A "schedule" is created with a name + year and owns three term parts (Fall,
// Winter, Spring), each a separate offerings collection (see the integration
// plan). The app works on one term part at a time (`activeTerm`): the grid/day/
// slot/course/instructor views and edit operations all target that part, so Math
// and Biology can each have their own named yearly schedules and the registrar
// its own. Any subset of schedules may be displayed at once, merged per term.

import {
  buildIndex,
  moveOfferingSmart,
  updateOfferingInSchedule,
  DEFAULT_SLOT,
  nextSectionLetter,
  addOfferingToSchedule,
  removeOfferingFromSchedule,
  TERM_KEYS,
} from '@major-vis/schedule-core'
import { buildFacultyAndEligible, makeSchedule } from '@major-vis/schedule-core/generate'
import { programs, allCourses } from '@major-vis/catalog-client'
import { diffOfferings, applyOperations, pureOps, suggestionStatus } from '@major-vis/schedule-core/diff'
import * as backend from './backend.js'

import { ref, computed, watch } from 'vue'

export const selectedDepartments = ref([])
export const selectedInstructors = ref([])
export const filterMode = ref('dept')

// Whether the filter chips panel is expanded. The mode buttons (Departments /
// Instructors) drive this: clicking the active mode collapses the picklist
// without clearing selections (the filter keeps applying); default closed.
export const filterPanelOpen = ref(false)

// ---- Schedule collection state ------------------------------------------
// Schedules are named, yearly entries with three term parts, persisted to
// localStorage (serverless) or to the major-vis backend (when one is present).
// The active term selects which part every view/edit operates on.
export const schedules = ref([])
export const selectedScheduleIds = ref([])
export const activeTerm = ref('F')

// True when the schedule app is served backed by the major-vis server; the
// store then mirrors writes to the API instead of localStorage.
export const remote = ref(false)

// True when a major-vis server answered the boot /api/config ping, whether or
// not the user signed in (or chose offline mode). Drives the auth-prompt
// dialog and the offline badge in the top nav.
export const serverDetected = ref(false)

// Whether the auth-prompt dialog is open (server present, no session yet, or
// the user is leaving offline mode).
export const authPromptOpen = ref(false)

// True when a server is present but the user chose to work offline (local-only
// storage for testing). The top nav shows the offline badge + "Go online".
export const offlineMode = computed(() => serverDetected.value && !remote.value)

// Whether to color courses by schedule when multiple schedules are shown and no
// department/instructor filter is active. Off by default (grid shows clean count
// summaries); can be toggled on to see each schedule's actual course list.
// Persisted locally.
export const colorSchedules = ref(false)

// The schedule currently being edited, or null. In edit mode the schedule's
// active-term courses can be dragged onto the grid's standard time slots to be
// rescheduled. Editing pairs with `editingRole`: 'edit' writes the term part
// directly (owners/serverless); 'suggest' edits a local draft that is turned
// into a suggestion (see pendingDrafts).
export const editingScheduleId = ref(null)

// How the active schedule session edits: 'edit' or 'suggest'. Null when no
// session is active.
export const editingRole = ref(null)

// Local drafts for suggest sessions, keyed `${scheduleId}:${term}`. A draft is
// the proposer's desired end state for the term (the base the calendar renders
// while the session is active); proposing diffs it against the server's current
// term and upserts the proposer's own pending suggestion. `dirty` tracks
// unsaved changes since the last propose.
export const pendingDrafts = ref({})

// Whether pending suggestions are overlaid on the calendar views. Persisted.
export const showPendingSuggestions = ref(true)

// The offering currently open in the course-edit modal (a merged item with `o`,
// `code`, `sid`, as produced for grid items), or null. Shared across the
// schedule views so the edit bar's "Add course" action can open the editor.
export const courseEditTarget = ref(null)

export function openCourseEdit(item) {
  courseEditTarget.value = item
}

export function closeCourseEdit() {
  courseEditTarget.value = null
}

const LS_SCHEDULES = 'major-vis.schedules'
const LS_SELECTED = 'major-vis.schedule.selected'
const LS_COLOR = 'major-vis.schedule.color'
const LS_TERM = 'major-vis.schedule.term'
const LS_PENDING = 'major-vis.schedule.pending'
const LS_TRAIL = 'major-vis.schedule.suggestions'
const LS_OFFLINE = 'major-vis.schedule.offline'

export function setColorSchedules(v) {
  colorSchedules.value = !!v
  if (typeof window !== 'undefined') localStorage.setItem(LS_COLOR, colorSchedules.value ? '1' : '0')
}

// Show/hide the pending-suggestions overlay on the calendar views.
export function setShowPendingSuggestions(v) {
  showPendingSuggestions.value = !!v
  if (typeof window !== 'undefined')
    localStorage.setItem(LS_PENDING, showPendingSuggestions.value ? '1' : '0')
}

// Switch which term part the app is looking at/editing. Persisted locally.
export function setActiveTerm(term) {
  if (!TERM_KEYS.includes(term)) return
  activeTerm.value = term
  if (typeof window !== 'undefined') localStorage.setItem(LS_TERM, term)
}

// Turn remote (server-backed) mode on/off. When on, schedule list/create and term
// edits are mirrored to the backend rather than persisted to localStorage.
export function setRemote(v) {
  remote.value = !!v
}

// Opens/closes the "sign in or work offline" auth prompt.
export function openAuthPrompt() {
  authPromptOpen.value = true
}
export function closeAuthPrompt() {
  authPromptOpen.value = false
}

// The user chose to work offline (testing only): flip to local-only storage,
// remember the choice so reloads stay offline, and seed the local sample. Any
// data created in offline mode lives only in this browser and never transfers
// to the server.
export function workOffline() {
  setRemote(false)
  if (typeof window !== 'undefined') localStorage.setItem(LS_OFFLINE, '1')
  closeAuthPrompt()
  seedSampleSchedule()
}

// Attempts to resume online (server) mode — the user chose "Go online" from
// the offline badge, or "Sign in" in the dialog. Clears the offline choice and
// re-enables remote mode. Returns true when a session was found and the server
// collection loaded (the dialog closes); false when there is no session yet
// (the dialog shows the sign-in form). Server state fully replaces whatever
// offline work was in this browser.
export async function resumeOnline() {
  if (typeof window !== 'undefined') localStorage.removeItem(LS_OFFLINE)
  if (!serverDetected.value) return false
  setRemote(true)
  const user = await loadCurrentUser()
  if (!user) return false
  closeAuthPrompt()
  if (await loadServerState()) restoreAux()
  return true
}

// ---- Ownership + suggested changes --------------------------------------
// The signed-in user (username self-identify). Populated when remote; used to
// decide whether a schedule is editable directly or only by suggestion.

export const currentUser = ref(null)

// Loads the current user from the backend when in remote mode. No-op (null)
// otherwise. Returns the user or null.
export async function loadCurrentUser() {
  if (!remote.value || typeof window === 'undefined') {
    currentUser.value = null
    return null
  }
  const user = await backend.fetchSession()
  currentUser.value = user
  return user
}

// Signs in with a username (self-identify, remote mode) and loads the shared
// server state. Returns true on success.
export async function signIn(username) {
  if (!remote.value || typeof window === 'undefined') return false
  const user = await backend.login(String(username || '').trim())
  if (!user) return false
  currentUser.value = user
  if (!(await loadServerState())) return false
  return true
}

// Signs out (remote mode): clears the session and the identity; the last
// loaded view stays until the next sign-in replaces it.
export async function signOut() {
  if (!remote.value || typeof window === 'undefined') return
  await backend.logout()
  currentUser.value = null
  suggestions.value = []
  suggestionsBySchedule.value = {}
  editingScheduleId.value = null
  editingRole.value = null
  pendingDrafts.value = {}
}

// Replaces the local view with the backend's schedule collection (after a
// sign-in, or at boot). Returns false when the backend isn't reachable /
// authenticated. Any drafts or sessions from the previous identity are
// dropped.
async function loadServerState() {
  const list = await backend.fetchSchedules()
  if (!list) return false
  schedules.value = list
  const selected = loadSelectedSchedules()
  const valid = (sel) =>
    Array.isArray(sel) && sel.filter((id) => schedules.value.some((s) => s.id === id)).length > 0
  selectedScheduleIds.value = valid(selected)
    ? selected.filter((id) => schedules.value.some((s) => s.id === id))
    : schedules.value.length
      ? [schedules.value[0].id]
      : []
  persistSelectedSchedules()
  editingScheduleId.value = null
  editingRole.value = null
  pendingDrafts.value = {}
  refreshAllSuggestions()
  return true
}

// Whether the supplied schedule is owned by the current user. Without a
// backend every schedule belongs to the single local user (offline mirrors the
// live flow, so self-approve/reject of one's own trail rows works the same).
export function isOwner(schedule) {
  if (!schedule) return false
  if (!remote.value) return true
  if (!currentUser.value) return false
  if (schedule.owner_user_id == null) return false
  return Number(schedule.owner_user_id) === Number(currentUser.value.id)
}

// Visible suggestions per schedule id (the server's visibility rule: everyone
// sees pending from all proposers, plus their own history; the owner sees all).
// Offline this mirrors the localStorage trail (single proposer: everything).
export const suggestionsBySchedule = ref({})

// The visible list for the last-refreshed schedule; kept for components that
// render a single schedule's list.
export const suggestions = ref([])

// Fetches (remote) or reads from the local trail (offline) the visible
// suggestion list for `scheduleId` and refreshes both refs.
export async function refreshSuggestions(scheduleId) {
  const list =
    remote.value && typeof window !== 'undefined'
      ? await backend.fetchSuggestions(scheduleId)
      : trailFor(scheduleId)
  suggestionsBySchedule.value = { ...suggestionsBySchedule.value, [scheduleId]: list }
  suggestions.value = list
  return list
}

// Refreshes suggestions for every selected schedule (and an active session's
// target). Used on load, on selection changes, and after session actions. In
// remote mode only schedules the server has acknowledged (owner_user_id set)
// are fetched — an entry awaiting its create round-trip has a client-only id
// that the API can't resolve, so fetching its suggestions would 404.
export function refreshAllSuggestions() {
  const ids = new Set(selectedScheduleIds.value)
  if (editingScheduleId.value) ids.add(editingScheduleId.value)
  for (const id of ids) {
    if (remote.value) {
      const s = scheduleById(id)
      if (!s || s.owner_user_id == null) continue
    }
    void refreshSuggestions(id)
  }
}

// ---- Drafts (suggest sessions) ------------------------------------------

function draftKey(scheduleId, term) {
  return `${scheduleId}:${term}`
}

function getDraft(scheduleId, term) {
  return pendingDrafts.value[draftKey(scheduleId, term)] || null
}

function setDraft(scheduleId, term, draft) {
  pendingDrafts.value = { ...pendingDrafts.value, [draftKey(scheduleId, term)]: draft }
}

function touchDraft() {
  pendingDrafts.value = { ...pendingDrafts.value }
}

// Discards a suggest session's draft for a (schedule, term) — used when leaving
// a session with unsaved changes.
export function clearDraft(scheduleId, term = activeTerm.value) {
  const drafts = { ...pendingDrafts.value }
  delete drafts[draftKey(scheduleId, term)]
  pendingDrafts.value = drafts
}

// Whether `scheduleId` is being edited as a suggestion right now.
export function isSuggestSessionFor(scheduleId) {
  return editingRole.value === 'suggest' && editingScheduleId.value === scheduleId
}

// The draft/term part that edit operations act on for `scheduleId`: the draft
// when a suggest session targets it, else the schedule's term part.
function mutablePart(scheduleId, term = activeTerm.value) {
  if (isSuggestSessionFor(scheduleId)) {
    let d = getDraft(scheduleId, term)
    if (!d) {
      d = { offerings: [], version: 0, dirty: false }
      setDraft(scheduleId, term, d)
    }
    return { part: d, draft: true }
  }
  const s = scheduleById(scheduleId)
  return { part: s && s.terms[term], draft: false }
}

// The draft of the active suggest session (or null) — for the edit bar badge.
export const editingDraft = computed(() => {
  if (editingRole.value !== 'suggest' || !editingScheduleId.value) return null
  return getDraft(editingScheduleId.value, activeTerm.value)
})

// Sets up (or keeps) the draft of a suggest session for `scheduleId`'s term:
// the base is the published term, with the proposer's own pending operations
// replayed on top (their previously proposed intent survives approvals). A
// DIRTY draft (unsaved edits) is kept so work is never lost; a clean one —
// its content already proposed — is rebuilt so re-entering a session always
// starts from the freshest published state. Remote mode then fetches the
// freshest term and re-bases once more.
async function setupDraft(scheduleId, term) {
  const existing = getDraft(scheduleId, term)
  if (existing && existing.dirty) return
  const s = scheduleById(scheduleId)
  if (!s) return
  const part = publishedPart(s, term) || { offerings: [], version: 0 }
  // Replay the proposer's own still-live intent onto the fresh published base.
  // Owner-decided ops are already reflected in the term (accepted) or are dead
  // intent (rejected); outline ops are dead intent too — none of them replay.
  const ownReplay = (own) =>
    own ? pureOps(own.operations.filter((e) => !e.resolution || e.resolution.status === 'pending')) : []
  const own = ownPendingSuggestion(scheduleId, term)
  setDraft(scheduleId, term, {
    offerings: applyOperations(part.offerings, ownReplay(own)),
    version: part.version,
    dirty: false,
  })
  if (!remote.value || typeof window === 'undefined') return
  const current = await backend.fetchTerm(scheduleId, term)
  if (!current || editingScheduleId.value !== scheduleId) return
  setLocalTerm(scheduleId, term, current.offerings, current.version)
  const own2 = ownPendingSuggestion(scheduleId, term)
  setDraft(scheduleId, term, {
    offerings: applyOperations(current.offerings, ownReplay(own2)),
    version: current.version,
    dirty: false,
  })
}

// Creates a draft for the freshly-active term when the session crosses terms.
watch(activeTerm, (term) => {
  if (editingRole.value === 'suggest' && editingScheduleId.value) {
    void setupDraft(editingScheduleId.value, term)
  }
})

// The diff operations a draft would propose (published term -> draft), for the
// panel's preview before committing.
export function draftOperations(scheduleId, term = activeTerm.value) {
  const d = getDraft(scheduleId, term)
  const s = scheduleById(scheduleId)
  if (!d || !s) return []
  const base = publishedOfferings(s, term)
  return diffOfferings(base, d.offerings || [])
}

// Proposes the draft of `scheduleId`'s active term as a suggestion. Remote:
// diffs against the server's fresh current term and upserts the proposer's own
// pending suggestion (create, or PATCH the existing one). Offline: the same
// against the local store with a localStorage trail. Returns the suggestion row
// or null when there is nothing to propose.
export async function proposeDraft(scheduleId, note) {
  const term = activeTerm.value
  const draft = getDraft(scheduleId, term)
  if (!draft) return null
  const s = scheduleById(scheduleId)
  if (!s) return null
  // Operations are proposed pure (diffOfferings output); entries — each op with
  // its own id + resolution — are the stored shape on server and trail alike.
  // The server wraps fresh ops into pending entries; the offline trail creates
  // them here so both sides look identical everywhere.
  const entriesFor = (ops) => (ops || []).map((op) => ({ id: opId(), op, resolution: { status: 'pending' } }))
  if (remote.value && typeof window !== 'undefined') {
    const current = await backend.fetchTerm(scheduleId, term)
    if (!current) return null
    const ops = diffOfferings(current.offerings || [], draft.offerings || [])
    draft.dirty = false
    if (!ops.length) return null
    const own = ownPendingSuggestion(scheduleId, term)
    // Re-proposing identical operations is a no-op (the upsert would be empty).
    // Rows carry entries; compare the pure op payloads only.
    if (own && JSON.stringify(pureOps(own.operations)) === JSON.stringify(ops)) return null
    const saved = own
      ? await backend.updateSuggestion(own.id, {
          operations: ops,
          note: String(note || '').trim() || own.note,
        })
      : await backend.createSuggestion(scheduleId, {
          term,
          baseVersion: current.version,
          operations: ops,
          note: String(note || '').trim(),
        })
    setLocalTerm(scheduleId, term, current.offerings, current.version)
    draft.version = current.version
    if (saved) await refreshSuggestions(scheduleId)
    return saved
  }
  const part = publishedPart(s, term) || { offerings: [], version: 0 }
  const ops = diffOfferings(part.offerings || [], draft.offerings || [])
  draft.dirty = false
  if (!ops.length) return null
  const rows = trailRows()
  const own = ownPendingSuggestion(scheduleId, term)
  let row
  if (own) {
    row = { ...own, operations: entriesFor(ops), note: String(note || '').trim() || own.note || '' }
    rows[rows.indexOf(own)] = row
  } else {
    row = {
      id: suggestionId(),
      schedule_id: scheduleId,
      term,
      proposer_user_id: null,
      proposer: 'you',
      status: 'pending',
      base_version: part.version,
      operations: entriesFor(ops),
      note: String(note || '').trim(),
      created_at: new Date().toISOString(),
      resolved_at: null,
    }
    rows.push(row)
  }
  persistTrail(rows)
  draft.version = part.version
  await refreshSuggestions(scheduleId)
  return row
}

// ---- Suggestion lifecycle -----------------------------------------------

// The proposer's own pending suggestion for a (schedule, term), or null. A row
// under review (any op the *owner* has decided) is excluded: further edits from
// the proposer go to a fresh row instead of disturbing an in-progress review.
// The proposer's own outline ops don't count — they can always withdraw them.
function ownPendingSuggestion(scheduleId, term) {
  const list = suggestionsBySchedule.value[scheduleId] || []
  const underReview = (s) =>
    (s.operations || []).some((e) => {
      const status = e.resolution && e.resolution.status
      return status === 'accepted' || status === 'rejected'
    })
  if (remote.value) {
    const uid = currentUser.value && currentUser.value.id
    return (
      list.find(
        (s) =>
          s.status === 'pending' &&
          s.term === term &&
          !underReview(s) &&
          Number(s.proposer_user_id) === Number(uid),
      ) || null
    )
  }
  return list.find((s) => s.status === 'pending' && s.term === term && !underReview(s)) || null
}

// Resolves one operation of a suggestion by its op id: 'accepted' applies
// exactly that op to the term (remote: the server applies it and the response
// term becomes the published state; offline: applied here with the same
// semantics), 'rejected' records the decision without touching the term. Each
// op is first-class (its own id + resolution); the row's status is derived from
// its ops and stays 'pending' until every op is resolved, then finalizes to
// 'approved' (some accepted op changed the term), 'moot' (accepted ops changed
// nothing), 'withdrawn' (the proposer pulled the rest), or 'rejected' (the
// owner rejected everything). Returns the updated suggestion, or null when the
// op could not be resolved (not pending, already resolved, unknown id, ...).
export async function resolveOp(id, opId, decision) {
  const row = (suggestions.value || []).find((s) => s.id === id) || null
  const scheduleId = row ? row.schedule_id : null
  const term = row ? row.term : activeTerm.value
  if (remote.value && typeof window !== 'undefined') {
    const result =
      decision === 'accepted'
        ? await backend.approveSuggestion(id, opId)
        : await backend.rejectSuggestion(id, opId)
    if (!result) return null
    if (result.term && result.term.term && result.term.schedule_id) {
      setLocalTerm(result.term.schedule_id, result.term.term, result.term.offerings, result.term.version)
    }
    if (scheduleId) await refreshSuggestions(scheduleId)
    return result.suggestion || null
  }
  if (!row || row.status !== 'pending') return null
  const entry = (row.operations || []).find((e) => e.id === opId) || null
  if (!entry || (entry.resolution && entry.resolution.status) !== 'pending') return null
  const s = scheduleById(scheduleId)
  const part = publishedPart(s, term)
  if (!part) return null
  let resolution
  if (decision === 'accepted') {
    const applied = applyOperations(part.offerings || [], [entry.op])
    const changed = diffOfferings(part.offerings || [], applied).length > 0
    if (changed) {
      part.offerings = applied
      part.version = (part.version || 0) + 1
      schedules.value = [...schedules.value]
      persistSchedules()
    }
    resolution = { status: 'accepted', applied: changed, resolved_at: new Date().toISOString() }
  } else {
    resolution = { status: 'rejected', resolved_at: new Date().toISOString() }
  }
  const operations = (row.operations || []).map((e) => (e.id === opId ? { ...e, resolution } : e))
  const next = finishTrailRow(row, operations)
  await refreshSuggestions(scheduleId)
  return next
}

// Withdraws the proposer's own pending change(s): one op when `opId` is given,
// else every remaining pending op of the suggestion (the "withdraw all"
// convenience). Owner-decided ops are never touched. Soft status — the ops stay
// in the trail as 'withdrawn'. Returns the updated suggestion or null.
export async function withdrawSuggestion(id, opId) {
  if (remote.value && typeof window !== 'undefined') {
    const saved = await backend.withdrawSuggestion(id, opId)
    if (!saved) return null
    const row = (suggestions.value || []).find((s) => s.id === id)
    if (row && row.schedule_id) await refreshSuggestions(row.schedule_id)
    return saved
  }
  const rows = trailRows()
  const row = rows.find((r) => r.id === id) || null
  if (!row || row.status !== 'pending') return null
  const pending = (row.operations || []).filter((e) => !e.resolution || e.resolution.status === 'pending')
  const targets = opId != null ? pending.filter((e) => e.id === opId) : pending
  if (!targets.length) return null
  const resolvedAt = new Date().toISOString()
  const operations = (row.operations || []).map((e) =>
    targets.includes(e) ? { ...e, resolution: { status: 'withdrawn', resolved_at: resolvedAt } } : e,
  )
  const next = finishTrailRow(row, operations)
  await refreshSuggestions(row.schedule_id)
  return next
}

// Completes an offline trail row after resolving ops: derives the row status +
// resolved_at from the entries and persists. Returns the updated row.
function finishTrailRow(row, operations) {
  const next = { ...row, operations }
  const finalStatus = suggestionStatus(operations)
  if (finalStatus) {
    next.status = finalStatus
    const resolved = operations
      .map((e) => e.resolution && e.resolution.resolved_at)
      .filter(Boolean)
      .sort()
      .at(-1)
    next.resolved_at = resolved || null
  }
  persistTrail(trailRows().map((r) => (r.id === row.id ? next : r)))
  return next
}

// Pending suggestions across the selected schedules for the active term, with a
// scheduleId tag — the overlay source for the calendar views. The overlay core
// is stateless, so operations arrive as pure payloads and only for entries
// still unresolved (owner-decided and withdrawn changes are not proposals).
export const pendingSuggestionsForTerm = computed(() => {
  const out = []
  for (const sid of selectedScheduleIds.value) {
    for (const s of suggestionsBySchedule.value[sid] || []) {
      if (s.status === 'pending' && s.term === activeTerm.value) {
        out.push({
          ...s,
          scheduleId: sid,
          operations: pureOps(
            (s.operations || []).filter((e) => !e.resolution || e.resolution.status === 'pending'),
          ),
        })
      }
    }
  }
  return out
})

function suggestionId() {
  return 'sg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function opId() {
  return 'op_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// ---- Offline suggestion trail (localStorage mirror) ---------------------
// Serverless mode keeps the same suggestion lifecycle locally: pending rows are
// proposed from drafts, can be approved/rejected/withdrawn, and the trail is
// the paper trail.

function trailRows() {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LS_TRAIL)
    const arr = raw ? JSON.parse(raw) : null
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function persistTrail(rows) {
  if (typeof window === 'undefined') return
  localStorage.setItem(LS_TRAIL, JSON.stringify(rows))
}

function trailFor(scheduleId) {
  return trailRows().filter((r) => r.schedule_id === scheduleId)
}

// Updates the published (non-draft) term part from the server.
function setLocalTerm(scheduleId, term, offerings, version) {
  const s = scheduleById(scheduleId)
  if (!s) return
  if (!s.terms[term]) s.terms[term] = { offerings: [], version: 0 }
  s.terms[term].offerings = [...(offerings || [])]
  s.terms[term].version = version
  schedules.value = [...schedules.value]
}

export function scheduleById(id) {
  return schedules.value.find((s) => s.id === id) || null
}

function scheduleId() {
  return 'sched_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// After a local mutation of a schedule's term part, mirror it to the server when
// in remote mode (fire-and-forget; the next full load reconciles any failure).
// Only owners write directly; a non-owner's change is surfaced through the
// propose flow (`submitTermSuggestion`) in the UI, never written to the schedule.
function syncTerm(id, term = activeTerm.value) {
  if (!remote.value || typeof window === 'undefined') return
  const s = scheduleById(id)
  const part = publishedPart(s, term)
  if (!part) return
  if (isOwner(s)) backend.replaceTerm(id, term, part.offerings)
}

// The schedule's stored term part — never the suggest-session draft. This is
// the source of truth for diffs, applies, syncs, and anything asserting what is
// actually on the schedule; views that should render the proposer's working
// state during a suggest session use `viewPart` instead. Returns null when the
// schedule has no such part.
export function publishedPart(schedule, term = activeTerm.value) {
  if (!schedule) return null
  return (schedule.terms || {})[term] || null
}

// Offerings of the published term part (never the draft).
export function publishedOfferings(schedule, term = activeTerm.value) {
  const part = publishedPart(schedule, term)
  return part ? part.offerings : []
}

// The term part to render, defaulting to the empty part. `term` defaults to the
// active term; explicit (year, term) lookups are used by the year picker.
// During a suggest session the draft stands in for the published term part, so
// every view renders the proposer's working state. Read the stored truth via
// `publishedPart` whenever the question is "what is on the schedule", not
// "what should I draw".
export function viewPart(schedule, term = activeTerm.value) {
  if (!schedule) return null
  if (isSuggestSessionFor(schedule.id)) {
    const draft = getDraft(schedule.id, term)
    if (draft) return { offerings: draft.offerings, version: draft.version }
  }
  return publishedPart(schedule, term) || { offerings: [], version: 0 }
}

// Offerings of the view part (the draft during a suggest session).
export function viewOfferings(schedule, term = activeTerm.value) {
  const part = viewPart(schedule, term)
  return part ? part.offerings : []
}

// Adds a schedule, creating its three empty term parts. `offerings` (optional)
// seeds the active term part. Remote: waits for the server to confirm before
// the schedule appears — no optimistic ghosts; a failed create returns null
// and the caller can show an error and let the user retry. Offline: resolves
// immediately. Selects the schedule and returns its id (or null).
export async function addSchedule(name, year, offerings) {
  if (remote.value) {
    const srv = await backend.createSchedule({ name, year })
    if (!srv) return null
    schedules.value = [...schedules.value, srv]
    selectedScheduleIds.value = [...selectedScheduleIds.value, srv.id]
    persistSelectedSchedules()
    if (offerings && offerings.length) setTermOfferings(srv.id, activeTerm.value, offerings)
    refreshAllSuggestions()
    return srv.id
  }
  const schedule = { id: scheduleId(), name, year, terms: emptyTerms() }
  if (offerings) schedule.terms[activeTerm.value].offerings = [...offerings]
  schedules.value = [...schedules.value, schedule]
  selectedScheduleIds.value = [...selectedScheduleIds.value, schedule.id]
  persistSchedules()
  persistSelectedSchedules()
  return schedule.id
}

function emptyTerms() {
  const empty = {}
  for (const t of TERM_KEYS) empty[t] = { offerings: [], version: 0 }
  return empty
}

// Replaces the active term part of a schedule with `offerings` (CSV import,
// generation, or a full-term paste), bumping its version. In a suggest session
// the replacement lands in the draft instead; remote non-owners may only
// change the active term through a draft (direct writes are the owner's).
export function setTermOfferings(id, term, offerings) {
  const s = scheduleById(id)
  if (!s) return false
  if (isSuggestSessionFor(id)) {
    const { part } = mutablePart(id, term)
    part.offerings = [...(offerings || [])]
    part.dirty = true
    touchDraft()
    return true
  }
  if (remote.value && !isOwner(s)) return false
  if (!s.terms[term]) s.terms[term] = { offerings: [], version: 0 }
  s.terms[term].offerings = [...(offerings || [])]
  s.terms[term].version = (s.terms[term].version || 0) + 1
  schedules.value = [...schedules.value]
  syncTerm(id, term)
  persistSchedules()
  return true
}

// Removes a schedule and deselects it if it was visible.
export function deleteSchedule(id) {
  schedules.value = schedules.value.filter((s) => s.id !== id)
  selectedScheduleIds.value = selectedScheduleIds.value.filter((x) => x !== id)
  if (editingScheduleId.value === id) {
    editingScheduleId.value = null
    editingRole.value = null
  }
  const restSugs = {}
  for (const [k, v] of Object.entries(suggestionsBySchedule.value)) {
    if (k !== String(id)) restSugs[k] = v
  }
  suggestionsBySchedule.value = restSugs
  const drafts = { ...pendingDrafts.value }
  for (const key of Object.keys(drafts)) {
    if (key.startsWith(id + ':')) delete drafts[key]
  }
  pendingDrafts.value = drafts
  if (remote.value) backend.deleteSchedule(id)
  persistSchedules()
  persistSelectedSchedules()
}

// Renames a schedule. No-op (returns false) if the schedule can't be found or
// the new name is blank/unchanged.
export function renameSchedule(id, name) {
  const s = scheduleById(id)
  const trimmed = String(name || '').trim()
  if (!s || !trimmed || trimmed === s.name) return false
  s.name = trimmed
  schedules.value = [...schedules.value]
  if (remote.value) backend.updateScheduleMeta(id, { name: trimmed })
  persistSchedules()
  return true
}

// Duplicates a schedule (deep-copied term parts) under an auto-generated name
// and selects it. Remote: the copy is created server-side (awaited, so a
// failed duplicate returns null and leaves no ghost) and each non-empty term
// is mirrored. Returns the new schedule's id, or null if the source is missing
// or the server didn't confirm.
export async function duplicateSchedule(id) {
  const s = scheduleById(id)
  if (!s) return null
  const terms = {}
  for (const t of TERM_KEYS) {
    terms[t] = {
      offerings: (s.terms[t]?.offerings || []).map((o) => ({ ...o })),
      version: s.terms[t]?.version || 0,
    }
  }
  if (remote.value) {
    const srv = await backend.createSchedule({ name: s.name + ' (copy)', year: s.year })
    if (!srv) return null
    schedules.value = [...schedules.value, srv]
    selectedScheduleIds.value = [...selectedScheduleIds.value, srv.id]
    persistSelectedSchedules()
    for (const t of TERM_KEYS) {
      if (terms[t].offerings.length) setTermOfferings(srv.id, t, terms[t].offerings)
    }
    refreshAllSuggestions()
    return srv.id
  }
  const copy = { id: scheduleId(), name: s.name + ' (copy)', year: s.year, terms }
  schedules.value = [...schedules.value, copy]
  selectedScheduleIds.value = [...selectedScheduleIds.value, copy.id]
  persistSchedules()
  persistSelectedSchedules()
  return copy.id
}

export function toggleSchedule(id) {
  const i = selectedScheduleIds.value.indexOf(id)
  if (i < 0) selectedScheduleIds.value = [...selectedScheduleIds.value, id]
  else selectedScheduleIds.value = selectedScheduleIds.value.filter((x) => x !== id)
  persistSelectedSchedules()
}

// Keep each selected schedule's suggestion list fresh (offline reads the trail;
// remote fetches on selection changes only).
watch(selectedScheduleIds, () => refreshAllSuggestions())

// The schedule being edited (null if not in edit mode).
export const editingSchedule = computed(() =>
  editingScheduleId.value ? scheduleById(editingScheduleId.value) : null,
)

// Enters/starts a session on `id` (or exits when `id` is null/falsy). `role` is
// 'edit' (direct writes; remote requires ownership) or 'suggest' (edits land in
// a draft and are proposed). Resolves to true when the session is entered and
// (for suggest) its draft is set up; false when the schedule is missing or the
// role is refused. Callers that don't await it still get a working session.
export function setEditingSchedule(id, role = 'edit') {
  if (!id) {
    editingScheduleId.value = null
    editingRole.value = null
    return Promise.resolve(true)
  }
  const target = id ? scheduleById(id) : null
  if (!target) return Promise.resolve(false)
  if (remote.value && role !== 'suggest' && !isOwner(target)) return Promise.resolve(false)
  editingScheduleId.value = target.id
  editingRole.value = role === 'suggest' ? 'suggest' : 'edit'
  if (role !== 'suggest') return Promise.resolve(true)
  return refreshSuggestions(target.id)
    .then(() => setupDraft(target.id, activeTerm.value))
    .then(() => true)
}

// Reschedules a single offering of `scheduleId`'s active term into a standard
// slot. The `move` context is `{ fromDay, toDay, group, time }` (see
// `rescheduleDays`). No-op if the offering can't be found. In a suggest session
// the change lands in the draft instead of the published term.
export function moveOffering(id, prefix, number, section, move) {
  const s = scheduleById(id)
  if (!s) return false
  const { part, draft } = mutablePart(id)
  if (!part) return false
  const next = moveOfferingSmart(part.offerings || [], { prefix, number, section }, move, activeTerm.value)
  if (next === part.offerings) return false
  part.offerings = next
  if (draft) {
    part.dirty = true
    touchDraft()
    return true
  }
  part.version = (part.version || 0) + 1
  schedules.value = [...schedules.value]
  syncTerm(id)
  persistSchedules()
  return true
}

// Rewrites an offering's editable fields (instructor / section / days / time)
// in the schedule's active term. `cur` is the offering's current identity
// (prefix/number/section) used to locate it; `changes` replaces the rest. In a
// suggest session the change lands in the draft.
export function updateOffering(id, cur, changes) {
  const s = scheduleById(id)
  if (!s) return false
  const { part, draft } = mutablePart(id)
  if (!part) return false
  const next = updateOfferingInSchedule(part.offerings || [], cur, changes)
  if (next === part.offerings) return false
  part.offerings = next
  if (draft) {
    part.dirty = true
    touchDraft()
    return true
  }
  part.version = (part.version || 0) + 1
  schedules.value = [...schedules.value]
  syncTerm(id)
  persistSchedules()
  return true
}

// Adds a brand-new catalog course (by code) to the schedule's active term,
// landing it in the default slot with the first free section letter. Returns the
// merged edit-item ({ o, code, sid }) so the caller can open the course editor.
// In a suggest session the course lands in the draft.
export function addCourseToSchedule(id, code) {
  const s = scheduleById(id)
  if (!s) return null
  const { part, draft } = mutablePart(id)
  if (!part) return null
  const [prefix, number] = code.split(' ')
  const section = nextSectionLetter(part.offerings || [], prefix, number)
  const offering = { prefix, number, section, instructor: '', ...DEFAULT_SLOT }
  part.offerings = addOfferingToSchedule(part.offerings || [], offering)
  if (draft) {
    part.dirty = true
    touchDraft()
    return { o: offering, code, sid: id }
  }
  part.version = (part.version || 0) + 1
  schedules.value = [...schedules.value]
  syncTerm(id)
  persistSchedules()
  return { o: offering, code, sid: id }
}

// Removes the offering matching `cur` (prefix/number/section) from the
// schedule's active term. Also closes the editor if the edited course was the
// one removed. In a suggest session the removal lands in the draft.
export function removeCourseFromSchedule(id, cur) {
  const s = scheduleById(id)
  if (!s) return false
  const { part, draft } = mutablePart(id)
  if (!part) return false
  const next = removeOfferingFromSchedule(part.offerings || [], cur)
  if (next === part.offerings) return false
  part.offerings = next
  if (draft) {
    part.dirty = true
    touchDraft()
  } else {
    part.version = (part.version || 0) + 1
    schedules.value = [...schedules.value]
    syncTerm(id)
    persistSchedules()
  }
  if (courseEditTarget.value) {
    const o = courseEditTarget.value.o
    if (o.prefix === cur.prefix && o.number === cur.number && o.section === cur.section) {
      courseEditTarget.value = null
    }
  }
  return true
}

// Merged raw offerings across the selected schedules for the active term, tagged
// with their source schedule id.
export const scheduleOfferings = computed(() => {
  if (!schedules.value.length) return []
  const sel = new Set(selectedScheduleIds.value)
  const out = []
  for (const s of schedules.value) {
    if (!sel.has(s.id)) continue
    for (const o of viewOfferings(s, activeTerm.value)) out.push({ ...o, $sid: s.id })
  }
  return out
})

// The merged index over the selected schedules' active-term offerings.
export const schedule = computed(() => buildIndex(scheduleOfferings.value))

function persistSchedules() {
  // In remote mode the server holds the schedule collection; localStorage is
  // only used for the serverless fallback.
  if (typeof window === 'undefined' || remote.value) return
  localStorage.setItem(LS_SCHEDULES, JSON.stringify(schedules.value))
}
function persistSelectedSchedules() {
  if (typeof window === 'undefined') return
  localStorage.setItem(LS_SELECTED, JSON.stringify(selectedScheduleIds.value))
}
// Normalizes a stored schedule: older {id,name,offerings} records (single-term)
// become a schedule with that offering list in every part for backward
// compatibility; new records already carry `terms`.
function normalizeStored(raw) {
  if (Array.isArray(raw.offerings)) {
    const terms = {}
    for (const t of TERM_KEYS) terms[t] = { offerings: raw.offerings.map((o) => ({ ...o })), version: 0 }
    return { id: raw.id, name: raw.name, year: raw.year || '', terms }
  }
  if (raw.terms) {
    const terms = {}
    for (const t of TERM_KEYS)
      terms[t] =
        raw.terms[t] && Array.isArray(raw.terms[t].offerings)
          ? { offerings: raw.terms[t].offerings.map((o) => ({ ...o })), version: raw.terms[t].version || 0 }
          : { offerings: [], version: 0 }
    return { id: raw.id, name: raw.name, year: raw.year || '', terms }
  }
  return null
}
function loadSchedules() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LS_SCHEDULES)
    const arr = raw ? JSON.parse(raw) : null
    if (Array.isArray(arr) && arr.length) {
      const norm = arr.map(normalizeStored).filter(Boolean)
      if (norm.length) return norm
    }
  } catch {
    /* ignore */
  }
  return null
}
function loadSelectedSchedules() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LS_SELECTED)
    const arr = raw ? JSON.parse(raw) : null
    if (Array.isArray(arr)) return arr
  } catch {
    /* ignore */
  }
  return null
}

// Seed the schedule collection. Prefers schedules already saved in localStorage;
// otherwise populates from the freshly fetched sample schedule.
function seedSchedules(seedList) {
  const stored = loadSchedules()
  schedules.value = stored && stored.length ? stored : seedList.map(normalizeStored)
  if (!stored || !stored.length) persistSchedules()
  const selected = loadSelectedSchedules()
  const valid = (sel) =>
    Array.isArray(sel) && sel.filter((id) => schedules.value.some((s) => s.id === id)).length > 0
  if (valid(selected)) {
    selectedScheduleIds.value = selected.filter((id) => schedules.value.some((s) => s.id === id))
  } else {
    const base = schedules.value.find((s) => s.id === 'base') || schedules.value[0]
    selectedScheduleIds.value = base ? [base.id] : []
    persistSelectedSchedules()
  }
  if (typeof window !== 'undefined') {
    const c = localStorage.getItem(LS_COLOR)
    if (c !== null) colorSchedules.value = c === '1'
    const t = localStorage.getItem(LS_TERM)
    if (t && TERM_KEYS.includes(t)) activeTerm.value = t
    const p = localStorage.getItem(LS_PENDING)
    if (p !== null) showPendingSuggestions.value = p === '1'
  }
  if (!remote.value) refreshAllSuggestions()
}

// Bootstraps the collection. When the app is served by the major-vis backend it
// checks for an existing session: a returning user loads the shared schedule
// list silently; a visitor without a session sees the auth prompt (sign in, or
// work offline with local-only storage). A serverless deployment seeds the
// local sample schedule directly. Call after `loadCatalog` (it consults the
// catalog for the sample generation).
export async function initScheduleCollection() {
  if (typeof window === 'undefined') return
  const isRemote = await backend.detectRemote()
  serverDetected.value = isRemote
  if (!isRemote || localStorage.getItem(LS_OFFLINE) === '1') {
    setRemote(false)
    seedSampleSchedule()
    return
  }
  setRemote(true)
  const user = await loadCurrentUser()
  if (!user) {
    openAuthPrompt()
    return
  }
  if (await loadServerState()) restoreAux()
}

function restoreAux() {
  if (typeof window === 'undefined') return
  const c = localStorage.getItem(LS_COLOR)
  if (c !== null) colorSchedules.value = c === '1'
  const t = localStorage.getItem(LS_TERM)
  if (t && TERM_KEYS.includes(t)) activeTerm.value = t
  const p = localStorage.getItem(LS_PENDING)
  if (p !== null) showPendingSuggestions.value = p === '1'
}

// Bootstraps the collection with the deterministic "Fall sample schedule"
// generated from the live catalog (seed 42 for reproducibility) placed in its
// Fall term part. Call after the catalog has loaded (`loadCatalog`).
export function seedSampleSchedule() {
  const { facultyByPrefix, eligible } = buildFacultyAndEligible(programs.value, allCourses.value)
  const empty = {}
  for (const t of TERM_KEYS) empty[t] = { offerings: [], version: 0 }
  empty.F.offerings = makeSchedule('random', undefined, facultyByPrefix, eligible, 42)
  seedSchedules([{ id: 'base', name: 'Sample schedule', year: '', terms: empty }])
}

// Generates a new schedule from the live catalog. `mode` is 'random' (all
// departments), 'dept' (exclusively `dept`'s courses), or 'empty'. The generated
// offerings seed the schedule's active term. Awaits the schedule's creation
// (server-confirmed in remote mode); resolves to the new schedule's id or null.
/**
 * @param {{ mode: 'random' | 'dept' | 'empty'; dept?: string | null; name?: string; year?: string }} [opts]
 */
export async function generateSchedule(
  { mode, dept, name, year } = { mode: 'random', dept: null, name: '', year: '' },
) {
  let offerings
  let fallback
  const t = activeTerm.value
  if (mode === 'empty') {
    offerings = []
    fallback = 'Empty schedule'
  } else {
    const { facultyByPrefix, eligible } = buildFacultyAndEligible(programs.value, allCourses.value)
    const seed = Math.floor(Math.random() * 2 ** 31)
    offerings = makeSchedule(mode, dept, facultyByPrefix, eligible, seed, t)
    fallback = mode === 'dept' ? `Schedule for ${dept}` : 'Random schedule'
  }
  const label = name && name.trim() ? name.trim() : fallback
  return addSchedule(label, year, offerings)
}
