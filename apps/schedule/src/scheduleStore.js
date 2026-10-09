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
  DEFAULT_SEATS,
  nextSectionLetter,
  nextLabSeq,
  addOfferingToSchedule,
  removeOfferingFromSchedule,
  mergeOfferings,
  TERM_KEYS,
  offeringIdFor,
  uniqueOfferingId,
  assignOfferingIds,
  offeringCodeLabel,
  offeringSectionLabel,
  matchOffering,
  proposeOverlay,
} from '@major-vis/schedule-core'
import { buildFacultyAndEligible, makeSchedule } from '@major-vis/schedule-core/generate'
import {
  programs,
  allCourses,
  coreReqsByCode as catalogCoreReqsByCode,
  crossListOf,
} from '@major-vis/catalog-client'
import {
  diffOfferings,
  applyOperations,
  pureOps,
  suggestionStatus,
  describeChange,
  splitGroups,
  opGroupKey,
} from '@major-vis/schedule-core/diff'
import * as backend from './backend.js'
import { buildNameIndex, instructorLabel, canonicalInstructor } from './names.js'

import { ref, computed, watch } from 'vue'

export const selectedDepartments = ref([])
export const selectedInstructors = ref([])
export const selectedCoreReqs = ref([])
export const filterMode = ref('dept')

// The catalog's course-code -> core-requirement ids map, shared by the three
// calendar views and the core filter (schedule-core's `buildVisual` asks a
// resolver; this is the one seam between the catalog and that pure package).
export const coreReqsByCode = computed(() => catalogCoreReqsByCode())

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
// True once the collection has been initialized — seeded offline, or loaded
// from the backend after a session. A deep-linked edit/suggest session waits
// for this before deciding its target is missing.
export const collectionReady = ref(false)

// Whether the auth-prompt dialog is open (server present, no session yet, or
// the user is leaving offline mode).
export const authPromptOpen = ref(false)

// The identity provider the server advertises via /api/config: 'username'
// (self-identify) or 'oidc' (sign-in leaves for the issuer's hosted login).
export const authProvider = ref('username')

// Message for a sign-in that failed on the way back from the issuer — the
// server's OIDC callback returns the browser with ?auth_error=<code>. The auth
// prompt renders it; empty when there is nothing to report.
export const authError = ref('')

// True when a server is present but the user chose to work offline (local-only
// storage for testing). The top nav shows the offline badge + "Go online".
export const offlineMode = computed(() => serverDetected.value && !remote.value)

// Whether to color courses by schedule when multiple schedules are shown and no
// department/instructor filter is active. Off by default (grid shows clean count
// summaries); can be toggled on to see each schedule's actual course list.
// Persisted locally.
export const colorSchedules = ref(false)

// Which grid blocks to show: 'all' (standard bars + custom rails), 'normal'
// (bars only), or 'custom' (rails only). Persisted locally.
export const blockMode = ref('all')

// How tall the calendar is drawn: 'auto' (double when a slot is crowded),
// 'compact' (base scale), or 'tall' (always double). Shared by the week grid
// and the day timeline. Persisted locally.
export const verticalScale = ref('auto')

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
const LS_MODE = 'major-vis.schedule.blockMode'
const LS_SCALE = 'major-vis.schedule.verticalScale'
const LS_TERM = 'major-vis.schedule.term'
const LS_PENDING = 'major-vis.schedule.pending'
const LS_TRAIL = 'major-vis.schedule.suggestions'
const LS_OFFLINE = 'major-vis.schedule.offline'

export function setColorSchedules(v) {
  colorSchedules.value = !!v
  if (typeof window !== 'undefined') localStorage.setItem(LS_COLOR, colorSchedules.value ? '1' : '0')
}

// Show/hide grid blocks by type ('all' | 'normal' | 'custom'). Persisted.
export function setBlockMode(mode) {
  if (!['all', 'normal', 'custom'].includes(mode)) return
  blockMode.value = mode
  if (typeof window !== 'undefined') localStorage.setItem(LS_MODE, mode)
}

// How tall to draw the calendar ('auto' | 'compact' | 'tall'). Persisted.
export function setVerticalScale(mode) {
  if (!['auto', 'compact', 'tall'].includes(mode)) return
  verticalScale.value = mode
  if (typeof window !== 'undefined') localStorage.setItem(LS_SCALE, mode)
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

export function clearAuthError() {
  authError.value = ''
}

const AUTH_ERROR_TEXT = {
  invalid_state: 'That sign-in link is no longer valid — please try again.',
  sso_unavailable: 'The sign-in service is unreachable right now — please try again shortly.',
  sso_failed: 'Sign-in could not be completed — please try again.',
  sso_access_denied: 'Sign-in was cancelled.',
  email_missing: 'The sign-in service did not return an email address.',
}

// Turns ?auth_error=... (appended by the OIDC callback redirect) into a
// message and strips it from the address bar, so a reload is clean.
function consumeAuthError() {
  if (typeof window === 'undefined') return
  let url
  try {
    url = new URL(window.location.href)
  } catch {
    return
  }
  const code = url.searchParams.get('auth_error')
  if (!code) return
  authError.value = AUTH_ERROR_TEXT[code] || 'Sign-in failed — please try again.'
  url.searchParams.delete('auth_error')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}

// Leaves for the issuer's hosted login (OIDC provider). The server returns the
// browser to this app's path after the callback; a failed round-trip comes back
// with ?auth_error=..., which the boot path turns back into a message.
export function startSsoLogin() {
  if (typeof window === 'undefined') return
  clearAuthError()
  window.location.assign(backend.ssoLoginUrl(window.location.pathname || '/'))
}

// The user chose to work offline (testing only): flip to local-only storage,
// remember the choice so reloads stay offline, and seed the local sample. Any
// data created in offline mode lives only in this browser and never transfers
// to the server.
export function workOffline() {
  setRemote(false)
  if (typeof window !== 'undefined') localStorage.setItem(LS_OFFLINE, '1')
  closeAuthPrompt()
  clearDirectory()
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
  clearAuthError()
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

// Whether the signed-in user is an administrator (the server's ADMIN_USERNAMES
// config; the server includes the flag on every user object it returns).
export const isAdmin = computed(() => Boolean(currentUser.value && currentUser.value.admin))

// The user directory as a name index (username <-> display name), loaded with
// the server state. Identity on an offering stays the stored value; this index
// is only how it is displayed. Offline (or before it loads) it is empty, so
// labels fall back to the stored values.
export const directoryIndex = ref(buildNameIndex([]))
const clearDirectory = () => {
  directoryIndex.value = buildNameIndex([])
}

// The display label for a stored instructor value: the directory's full name
// when it knows the account, else the value itself. Display-only — filters,
// exports, and the stored record keep the canonical value.
export function instructorName(value) {
  return instructorLabel(value, directoryIndex.value)
}

// The value to store for instructor text the user typed or picked: a full name
// that names a directory account resolves to its short username; anything else
// is stored verbatim (new hires, adjuncts).
export function instructorValue(text) {
  return canonicalInstructor(text, directoryIndex.value)
}

// The signed-in user's departments (from the admin-maintained directory; the
// server includes them on every user object). Empty offline and for users
// without a directory entry.
export const myDepartments = computed(() => {
  const user = currentUser.value
  return (user && user.departments) || []
})

// ---- Cross-listed groups -------------------------------------------------
// A cross-listed course (per `cross_listings.json`) has sibling versions under
// other department codes; they are kept identical (same meeting, instructors,
// seats) and share one owning department. Rows carry `crossListOwner` (the
// owner's prefix, '' when the group came from an import and is still unowned).
// Membership is resolved from the catalog (schedule-core stays catalog-free),
// paired by the section letter.

// The `PREFIX NUMBER` code of a raw offering record.
function offeringCode(o) {
  return o ? `${o.prefix || ''} ${o.number || ''}`.trim() : ''
}

// The stored group owner of a row ('' for a plain or unowned row).
function crossListOwnerOf(o) {
  return String((o && o.crossListOwner) || '').toUpperCase()
}

// Whether a course code is cross-listed at all (catalog).
function isCrossListed(code) {
  return crossListOf(code).length > 0
}

// The sibling version rows of `cur` in `offerings`: other catalog-group members
// present with the same section letter, excluding labs and the row itself.
function crossListSiblingRows(offerings, cur) {
  const code = offeringCode(cur)
  const others = new Set(crossListOf(code))
  if (!others.size) return []
  return (offerings || []).filter((o) => !o.lab && o.section === cur.section && others.has(offeringCode(o)))
}

// The sibling version rows carrying the same meeting band as `band` (the source
// row's current `{ days, time }`). A cross-listed group is kept identical band
// by band, so a split-meeting edit must mirror onto the matching band in each
// version — not every row at the section (which would overwrite the other
// meetings). A blank band matches blank siblings (a freshly added meeting).
function crossListBandSiblings(offerings, cur, band) {
  return crossListSiblingRows(offerings, cur).filter(
    (o) => (o.days || '') === band.days && (o.time || '') === band.time,
  )
}

// Gives an unowned cross-listed group an owner: when `cur` names a row whose
// course is cross-listed and the group has no owner yet, every group row at the
// row's section (the row itself included) is stamped with the row's prefix —
// "the first edit claims ownership". Returns the same array when there is
// nothing to claim.
function claimCrossListOwnership(offerings, cur) {
  const list = offerings || []
  const target = list.find((o) => matchOffering(o, cur))
  if (!target || target.lab) return list
  if (crossListOwnerOf(target)) return list
  const codes = new Set([offeringCode(target), ...crossListOf(offeringCode(target))])
  if (codes.size < 2) return list
  const owner = String(target.prefix || '').toUpperCase()
  return list.map((o) =>
    !o.lab && o.section === target.section && codes.has(offeringCode(o))
      ? { ...o, crossListOwner: owner }
      : o,
  )
}

// The cross-listing picture for one offering, for the course editor / course
// view: the other catalog codes, which of them are present in the active term,
// and the stored owner. Returns null when the offering isn't on the schedule.
export function crossListState(scheduleId, cur) {
  const s = scheduleById(scheduleId)
  if (!s) return null
  const part = viewPart(s, activeTerm.value)
  const offerings = (part && part.offerings) || []
  const source = offerings.find((o) => matchOffering(o, cur))
  if (!source) return null
  const otherCodes = crossListOf(offeringCode(source))
  const present = otherCodes.filter((code) =>
    offerings.some((o) => !o.lab && o.section === source.section && offeringCode(o) === code),
  )
  return {
    crossListed: otherCodes.length > 0,
    code: offeringCode(source),
    otherCodes,
    present,
    missing: otherCodes.filter((code) => !present.includes(code)),
    owner: crossListOwnerOf(source) || null,
  }
}

// Materializes the group's missing versions onto the active term, copying the
// source row's scheduling fields (and its labs), for a cross-listed course. The
// caller is the group's owner (or claims it by acting); the source and any
// existing versions are stamped with the owner. Returns the created offerings
// ([] when there was nothing to create), and persists like any term mutation.
export function materializeCrossListVersions(id, cur) {
  const s = scheduleById(id)
  if (!s) return []
  const { part, draft } = mutablePart(id)
  if (!part) return []
  const before = part.offerings || []
  const source = before.find((o) => matchOffering(o, cur))
  if (!source) return []
  const groupCodes = [offeringCode(source), ...crossListOf(offeringCode(source))]
  if (groupCodes.length < 2) return []
  const owner = crossListOwnerOf(source) || String(source.prefix || '').toUpperCase()
  const sourceLabs = before.filter(
    (o) => o.lab && o.section === source.section && offeringCode(o) === offeringCode(source),
  )
  let list = before
  const created = []
  for (const code of groupCodes) {
    if (code === offeringCode(source)) continue
    const [prefix, number] = code.split(' ')
    if (list.some((o) => !o.lab && o.prefix === prefix && o.number === number)) continue
    const section = sectionIsFree(list, prefix, number, source.section)
      ? source.section
      : nextSectionLetter(list, prefix, number, activeTerm.value)
    const offering = {
      prefix,
      number,
      section,
      title: source.title || '',
      instructor: source.instructor || '',
      secondaryInstructors: [...(source.secondaryInstructors || [])],
      days: source.days || '',
      time: source.time || '',
      seats: source.seats != null ? source.seats : DEFAULT_SEATS,
      crossListOwner: owner,
      id: '',
    }
    offering.id = offeringIdFor(offering)
    list = addOfferingToSchedule(list, offering)
    created.push(offering)
    for (const lab of sourceLabs) {
      const labRow = {
        ...lab,
        prefix,
        number,
        section,
        title: source.title || '',
        id: '',
      }
      delete labRow.crossListOwner
      labRow.id = offeringIdFor(labRow)
      list = addOfferingToSchedule(list, labRow)
    }
  }
  if (!created.length && before.every((o) => crossListOwnerOf(o) === owner)) return []
  // Stamp the whole group (source + existing versions) with the owner.
  const groupSet = new Set(groupCodes)
  list = list.map((o) =>
    !o.lab && o.section === source.section && groupSet.has(offeringCode(o))
      ? { ...o, crossListOwner: owner }
      : o,
  )
  const changed = diffOfferings(before, list)
  if (!changed.length) return []
  part.offerings = list
  recordHistory(part, before, id)
  if (draft) {
    part.dirty = true
    touchDraft()
  } else {
    part.version = (part.version || 0) + 1
    schedules.value = [...schedules.value]
    syncTerm(id)
    persistSchedules()
  }
  return created
}

// Whether `section` is free for a lecture of (prefix, number) — labs never
// consume a lecture letter.
function sectionIsFree(offerings, prefix, number, section) {
  if (!section) return false
  return !(offerings || []).some(
    (o) => !o.lab && o.prefix === prefix && o.number === number && o.section === section,
  )
}

// Whether the active session may touch an offering: owners (and every offline
// session) may touch anything; a non-owner's suggest session is scoped to the
// user's departments — the client-side mirror of the server's `dept_restricted`
// rule. `offering` is the record (or a bare prefix for non-group callers).
// `action` is 'edit' (rewrite the row: a cross-listed group is the owner's to
// edit), 'add' (attach a version), or 'remove' (a member may remove its own
// version; the owner may remove any).
export function canTouchOffering(scheduleId, offering, action = 'edit') {
  const s = scheduleById(scheduleId)
  if (!s) return false
  if (editingRole.value !== 'suggest' || isOwner(s)) return true
  const mine = myDepartments.value.map((d) => String(d).toUpperCase())
  const rec = typeof offering === 'string' ? { prefix: offering } : offering || {}
  const prefix = String(rec.prefix || '').toUpperCase()
  const owner = String(rec.crossListOwner || '').toUpperCase()
  if (action === 'edit') return mine.includes(owner || prefix)
  return mine.includes(prefix) || mine.includes(owner)
}

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
  clearAuthError()
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
  clearDirectory()
  suggestions.value = []
  suggestionsBySchedule.value = {}
  editingScheduleId.value = null
  editingRole.value = null
  pendingDrafts.value = {}
}

// Replaces the local view with the backend's schedule collection (after a
// sign-in, or at boot). Returns false when the backend isn't reachable /
// authenticated. Any drafts or sessions from the previous identity are
// dropped. The default selection is the user's own schedules — a stranger's
// schedule is never auto-selected (it stays one search away in the manage
// dialog).
// Loads the directory roster into the name index (labels for instructors).
// Returns [] offline / unauthenticated, so the index just stays empty.
async function loadDirectory() {
  directoryIndex.value = buildNameIndex(await backend.fetchRoster())
}

async function loadServerState() {
  await loadDirectory()
  const list = await backend.fetchSchedules()
  if (!list) return false
  schedules.value = list
  const selected = loadSelectedSchedules()
  const valid = (sel) =>
    Array.isArray(sel) && sel.filter((id) => schedules.value.some((s) => s.id === id)).length > 0
  const firstOwned = ownedSchedules()[0]
  selectedScheduleIds.value = valid(selected)
    ? selected.filter((id) => schedules.value.some((s) => s.id === id))
    : firstOwned
      ? [firstOwned.id]
      : []
  persistSelectedSchedules()
  editingScheduleId.value = null
  editingRole.value = null
  pendingDrafts.value = {}
  refreshAllSuggestions()
  collectionReady.value = true
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

// The schedules owned by the current user (everything, offline).
export function ownedSchedules() {
  return schedules.value.filter((s) => isOwner(s))
}

// Whether the current user may propose suggestions for `schedule` — the
// client-side mirror of the server's rule: owners always can; 'public' opens
// it to everyone; 'shared' only to the listed suggesters (matching by
// canonical username). Offline everything is owned.
export function canSuggest(schedule) {
  if (!schedule) return false
  if (isOwner(schedule)) return true
  if (!remote.value || !currentUser.value) return false
  if (schedule.suggestMode === 'public') return true
  if (schedule.suggestMode === 'shared') {
    const me = String(currentUser.value.username || '').toLowerCase()
    return (schedule.suggesters || []).some((u) => String(u).toLowerCase() === me)
  }
  return false
}

// Updates a schedule's access settings (owner only): visibility/suggestMode
// modes and the viewer/suggester username lists. The server canonicalizes the
// lists and returns the stored schedule; the local row is replaced from that
// response so the UI always mirrors what the server actually kept. Returns the
// updated schedule or null when the server refused.
/**
 * @param {string} id
 * @param {{
 *   visibility?: 'private' | 'shared' | 'public';
 *   suggestMode?: 'owner' | 'shared' | 'public';
 *   viewers?: string[];
 *   suggesters?: string[];
 * }} [access]
 */
export async function updateScheduleAccess(id, { visibility, suggestMode, viewers, suggesters } = {}) {
  if (!remote.value || typeof window === 'undefined') return null
  const saved = await backend.updateScheduleMeta(id, { visibility, suggestMode, viewers, suggesters })
  if (!saved) return null
  schedules.value = schedules.value.map((s) => (s.id === id ? saved : s))
  return saved
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

// ---- Session change list (the "recent edits" of the active session) -----

// Not a classic undo stack: the history panel shows the NET difference between
// the session's base snapshot (what the term looked like when first touched in
// this session) and the current state — one row per affected course. Dragging
// a course to a slot and back nets to zero (no row); moving it twice nets to a
// single "move" row. Every row can be cancelled individually (its op leaves
// the net diff and the row flips to a cancelled, restorable state) or jumped
// straight into the course editor. The state is in-memory only and resets
// whenever the session changes; suggest-session edits go through the same
// finalize path as any other edit, so cancels rewrite the draft, not the term.
const sessionState = ref({})
let sessionSeq = 0

function historyKey(scheduleId, term) {
  return `${scheduleId}|${term}`
}

function clearAllHistory() {
  sessionState.value = {}
  sessionSeq = 0
}

// Reset the change list whenever the editing session changes — entering or
// leaving a session, switching the schedule under edit, or a sign-out/state
// load that clears the refs. Per-term lists survive switching the active term
// within a session (each is captured lazily at its first edit). Synced so the
// list is empty the moment a new session starts (before any edit could be
// recorded).
watch([editingScheduleId, editingRole], () => clearAllHistory(), { flush: 'sync' })

// Identity key of an op payload — add ops carry the offering, update/remove
// ops carry `cur` — mirroring the diff core's identity rules (the content id
// wins when present, else the section tuple + lab markers).
function opKeyOf(op) {
  const src = op && op.kind === 'add' ? op.offering : op && op.cur
  if (!src) return ''
  const id = src.id != null && src.id !== '' ? `#${src.id}` : ''
  return `${src.prefix}|${src.number}|${src.section || ''}|${src.lab ? 'lab' : 'lec'}|${src.labSeq || 0}${id}`
}

// Identity key of an offering row (the shape `opKeyOf` produces for it).
function identityKeyOf(o) {
  const id = o.id != null && o.id !== '' ? `#${o.id}` : ''
  return `${o.prefix}|${o.number}|${o.section || ''}|${o.lab ? 'lab' : 'lec'}|${o.labSeq || 0}${id}`
}

// One session unit per (scheduleId, term): the base snapshot (a deep copy of
// the term's offerings at first touch — the reference point every net diff is
// measured against), per-course recency + latest op content, and explicit-
// cancel tombstones (rows that stay listed as cancelled).
function ensureSession(scheduleId, term, before) {
  const k = historyKey(scheduleId, term)
  let s = sessionState.value[k]
  if (!s) {
    s = {
      base: (before || []).map((o) => ({ ...o })),
      touched: {},
      cancelled: {},
    }
    sessionState.value = { ...sessionState.value, [k]: s }
  }
  return s
}

// The net ops vs the session base for the current state of `part`.
function netOps(s, part) {
  return diffOfferings(s.base, part.offerings || [])
}

// Records one mutation of a term part. Callers invoke it AFTER assigning
// `part.offerings` and pass the array that was there before the assignment.
// Each affected course's row is refreshed with its net content and recency; a
// course that nets back to its base content (e.g. moved and moved back) drops
// out of the list entirely unless it was explicitly cancelled. A write that
// rewrites nothing records no entry at all.
function recordHistory(part, before, scheduleId, term = activeTerm.value) {
  if (!scheduleId) return
  const touched = diffOfferings(before || [], part.offerings || [])
  if (!touched.length) return
  const s = ensureSession(scheduleId, term, before)
  const net = new Map(netOps(s, part).map((op) => [opKeyOf(op), op]))
  let nextTouched = { ...s.touched }
  let nextCancelled = s.cancelled
  for (const op of touched) {
    const key = opKeyOf(op)
    if (net.has(key)) {
      nextTouched[key] = { op: net.get(key), seq: ++sessionSeq }
      if (nextCancelled[key]) {
        const c = { ...nextCancelled }
        delete c[key]
        nextCancelled = c
      }
    } else if (nextCancelled[key]) {
      // Netted out but explicitly cancelled: keep the row, refreshed.
      nextTouched[key] = { op, seq: ++sessionSeq }
    } else if (nextTouched[key]) {
      // Netted out naturally (e.g. dragged there and back): the row vanishes.
      const t = { ...nextTouched }
      delete t[key]
      nextTouched = t
    }
  }
  s.touched = nextTouched
  s.cancelled = nextCancelled
  sessionState.value = { ...sessionState.value }
}

// Restores `offerings` onto the session's term part through the same finalize
// path the mutators use: a suggest session writes the draft (dirty + touched);
// an edit session bumps the version and mirrors/persists, so cancelling a
// change of a remote term stays consistent with the server.
function finalizeHistoryWrite(part, draft, scheduleId, term) {
  if (draft) {
    part.dirty = true
    touchDraft()
    return
  }
  part.version = (part.version || 0) + 1
  schedules.value = [...schedules.value]
  syncTerm(scheduleId, term)
  persistSchedules()
}

// The active session's change list (or null when none is set up).
function activeSession() {
  const id = editingScheduleId.value
  if (!id) return null
  return sessionState.value[historyKey(id, activeTerm.value)] || null
}

// Whether the active session has any net change left to cancel.
export const canCancel = computed(() => {
  const id = editingScheduleId.value
  const s = id && activeSession()
  if (!s) return false
  const v = viewPart(scheduleById(id), activeTerm.value)
  return diffOfferings(s.base, v.offerings || []).length > 0
})

// The session's transcript, newest first, for the history panel: one row per
// course the session touched, showing its net change vs the base. Rows whose
// course returned to its base content drop out entirely unless they were
// explicitly cancelled (those stay listed, restorable). `editable` says
// whether the row's course currently exists in the term, so the panel can
// offer the jump-to-editor action only when there is something to edit.
export const historyEntries = computed(() => {
  const id = editingScheduleId.value
  if (!id) return []
  const s = activeSession()
  if (!s) return []
  const part = viewPart(scheduleById(id), activeTerm.value)
  const offers = part.offerings || []
  // Split sections are read from the base ∪ current rows, so a meeting that was
  // removed this session still labels as split (its row is gone from current).
  const groups = splitGroups([...s.base, ...offers])
  const net = new Map(diffOfferings(s.base, offers).map((op) => [opKeyOf(op), op]))
  const present = new Set(offers.map(identityKeyOf))
  const rows = []
  for (const [key, t] of Object.entries(s.touched)) {
    const active = net.get(key)
    const cancelled = !active
    if (!active && !s.cancelled[key]) continue
    const op = active || t.op
    rows.push({
      key,
      op,
      label: describeChange(op, { showMeeting: groups.has(opGroupKey(op)) }),
      seq: t.seq,
      cancelled,
      editable: present.has(key),
    })
  }
  return rows.sort((a, b) => b.seq - a.seq)
})

// The split-meeting section keys for a list of ops (entries or bare ops) against
// `scheduleId`'s published term, unioned with the ops' own rows so a newly added
// meeting counts. The suggest panel feeds the result to `describeChange`'s
// `showMeeting` so a split-meeting proposal reads apart.
export function splitGroupsFor(ops, scheduleId = editingScheduleId.value) {
  const s = scheduleId != null ? scheduleById(scheduleId) : null
  const part = s ? publishedPart(s, activeTerm.value) : null
  const published = (part && part.offerings) || []
  const rows = []
  for (const e of ops || []) {
    const op = e && e.op ? e.op : e
    if (!op) continue
    const row = op.kind === 'add' ? op.offering : op.cur
    if (row) rows.push(row)
  }
  return splitGroups([...published, ...rows])
}

// The net ops a cancel of `targetOp` removes: the op itself, plus — for a
// split-meeting op in a cross-listed group — the matching-band op in every
// sibling version, so cancelling a mirrored band keeps the group parallel.
function opsToCancel(current, targetOp, groups) {
  if (!targetOp || !groups.has(opGroupKey(targetOp))) return [targetOp]
  const row = targetOp.kind === 'add' ? targetOp.offering : targetOp.cur
  if (!row) return [targetOp]
  const ownCode = offeringCode(row)
  const sibs = crossListOf(ownCode)
  if (!sibs.length) return [targetOp]
  const codes = new Set([ownCode, ...sibs])
  const days = row.days || ''
  const time = row.time || ''
  return current.filter((op) => {
    const p = op.kind === 'add' ? op.offering : op.cur
    return (
      Boolean(p) &&
      codes.has(offeringCode(p)) &&
      p.section === row.section &&
      (p.days || '') === days &&
      (p.time || '') === time
    )
  })
}

// Cancels one change of the active session by key (the row's `key` from
// `historyEntries`): its op leaves the net diff — the state is recomputed as
// base + every other change, which is always conflict-free because each op
// targets a distinct course — and the row flips to cancelled (restorable). A
// split-meeting op in a cross-listed group cancels its matching band across
// every version, keeping the group parallel. Returns the cancelled change's
// label, or null when there is nothing to cancel (unknown key, already
// cancelled, or no session).
export function cancelChange(key) {
  const id = editingScheduleId.value
  const s = id && activeSession()
  if (!s) return null
  const { part, draft } = mutablePart(id)
  if (!part) return null
  const current = netOps(s, part)
  const targetOp = current.find((op) => opKeyOf(op) === key)
  if (!targetOp) return null
  const groups = splitGroups([...s.base, ...(part.offerings || [])])
  const drop = new Set(opsToCancel(current, targetOp, groups))
  part.offerings = applyOperations(
    s.base,
    current.filter((op) => !drop.has(op)),
  )
  let cancelled = s.cancelled
  for (const op of drop) {
    const k = opKeyOf(op)
    if (!cancelled[k]) cancelled = { ...cancelled, [k]: true }
  }
  s.cancelled = cancelled
  sessionState.value = { ...sessionState.value }
  finalizeHistoryWrite(part, draft, id, activeTerm.value)
  return describeChange(targetOp, { showMeeting: groups.has(opGroupKey(targetOp)) })
}

// Cancels the most recently touched *live* change of the active session — the
// keyboard "undo" (Cmd/Ctrl+Z). Returns the cancelled change's label or null.
export function cancelLatest() {
  const row = historyEntries.value.find((e) => !e.cancelled)
  return row ? cancelChange(row.key) : null
}

// Cancels every live change of the active session at once: the term returns to
// its session base and every row stays listed as cancelled (restorable).
// Returns true when at least one change was cancelled.
export function cancelAll() {
  const id = editingScheduleId.value
  const s = id && activeSession()
  if (!s) return false
  const { part, draft } = mutablePart(id)
  if (!part) return false
  const current = netOps(s, part)
  if (!current.length) return false
  part.offerings = s.base.map((o) => ({ ...o }))
  const cancelled = { ...s.cancelled }
  for (const op of current) cancelled[opKeyOf(op)] = true
  s.cancelled = cancelled
  sessionState.value = { ...sessionState.value }
  finalizeHistoryWrite(part, draft, id, activeTerm.value)
  return true
}

// Brings a cancelled change back: its op re-applies onto the current state
// (safe — nothing else touches that course) and the row returns to active.
// Returns true when the row existed and was cancelled.
export function restoreChange(key) {
  const id = editingScheduleId.value
  const s = id && activeSession()
  const entry = s && s.touched[key]
  if (!entry || !s.cancelled[key]) return false
  const { part, draft } = mutablePart(id)
  if (!part) return false
  part.offerings = applyOperations(part.offerings || [], [entry.op])
  const cancelled = { ...s.cancelled }
  delete cancelled[key]
  s.cancelled = cancelled
  sessionState.value = { ...sessionState.value }
  finalizeHistoryWrite(part, draft, id, activeTerm.value)
  return true
}

// Opens the course editor on the course a change row describes — the panel's
// "jump straight to this course" action. Resolves the op's identity against
// the current term (draft-aware during a suggest session) and reuses the
// shared course-edit target, so the editor opens above whatever view is
// active. Returns false when the course no longer exists (e.g. a `remove`
// change, or a cancelled `add`).
export function jumpToEdit(op) {
  const id = editingScheduleId.value
  if (!id) return false
  const schedule = scheduleById(id)
  if (!schedule) return false
  const key = opKeyOf(op)
  const found = viewOfferings(schedule, activeTerm.value).find((o) => identityKeyOf(o) === key)
  if (!found) return false
  courseEditTarget.value = { o: found, code: `${found.prefix} ${found.number}`, sid: id }
  return true
}

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
// when it was saved, null when there is nothing to propose, or a
// `{ error, codes? }` marker when the server refused (e.g. the dept-scoping
// `dept_restricted`) — the draft stays dirty so the proposer can fix it.
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
    // A refusal (an `{ error }` marker) keeps the draft dirty: nothing was
    // written, so the work is still unsaved and fixable.
    if (saved && !saved.error) {
      draft.dirty = false
      await refreshSuggestions(scheduleId)
    }
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

// The pending suggestions to draw on top of the displayed schedule. The
// proposer's own suggestion is left out while they are suggesting on that
// schedule: `setupDraft` already replays their pending ops into the working copy
// they see, so drawing them again would double every change. Every other
// proposal (and their own once they leave the session) still overlays.
export const overlaySuggestions = computed(() => {
  const list = pendingSuggestionsForTerm.value
  if (!list.length) return list
  const ownReplayed = new Set()
  for (const sid of selectedScheduleIds.value) {
    if (!isSuggestSessionFor(sid)) continue
    const own = ownPendingSuggestion(sid, activeTerm.value)
    if (own) ownReplayed.add(own.id)
  }
  if (!ownReplayed.size) return list
  return list.filter((s) => !ownReplayed.has(s.id))
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
  s.terms[term].offerings = assignOfferingIds([...(offerings || [])])
  s.terms[term].version = version != null ? version : (s.terms[term].version || 0) + 1
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

// Every offering of a course in `scheduleId`'s active term that shares the
// route's base code — its sections and labs (`BIO 166` also matches `BIO
// 166L`) — as merged `{ o, code, sid }` items, ordered by section label. Drives
// the course editor's section switcher and its deep-link resolution.
export function courseSections(scheduleId, code) {
  const schedule = scheduleById(scheduleId)
  if (!schedule) return []
  const base = String(code || '')
    .trim()
    .replace(/L$/i, '')
  if (!base) return []
  const out = []
  for (const o of viewOfferings(schedule, activeTerm.value)) {
    const label = offeringCodeLabel(o)
    if (label.replace(/L$/i, '') !== base) continue
    out.push({ o, code: label, sid: schedule.id })
  }
  out.sort((a, b) =>
    `${offeringSectionLabel(a.o)}`.localeCompare(`${offeringSectionLabel(b.o)}`, undefined, {
      numeric: true,
    }),
  )
  return out
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
  if (offerings) schedule.terms[activeTerm.value].offerings = assignOfferingIds([...offerings])
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
  const rows = assignOfferingIds([...(offerings || [])])
  if (isSuggestSessionFor(id)) {
    const { part } = mutablePart(id, term)
    const before = part.offerings
    part.offerings = rows
    recordHistory(part, before, id, term)
    part.dirty = true
    touchDraft()
    return true
  }
  if (remote.value && !isOwner(s)) return false
  if (!s.terms[term]) s.terms[term] = { offerings: [], version: 0 }
  const before = s.terms[term].offerings
  s.terms[term].offerings = rows
  recordHistory(s.terms[term], before, id, term)
  s.terms[term].version = (s.terms[term].version || 0) + 1
  schedules.value = [...schedules.value]
  syncTerm(id, term)
  persistSchedules()
  return true
}

// Imports parsed CSV rows into a schedule's term parts, grouped by each row's
// `term` column (F|W|S; rows without one default to the active term part).
// Each touched part is replaced wholesale via `setTermOfferings`, so a
// suggest session or a remote non-owner write still follows its rules. Returns
// a map of term -> rows written (empty when the schedule is missing or every
// part was blocked), e.g. `{ F: 3, S: 1 }`.
export function importCsvRows(scheduleId, rows) {
  if (!scheduleById(scheduleId)) return {}
  const byTerm = {}
  for (const r of rows || []) {
    const t = r.term && TERM_KEYS.includes(r.term.toUpperCase()) ? r.term.toUpperCase() : activeTerm.value
    if (!byTerm[t]) byTerm[t] = []
    const offering = { ...r }
    delete offering.term
    // The row's `coreReqs` is kept: the imported registrar feed is the source of
    // truth for a course's areas, and the views/filter/stats read it back (the
    // catalog fills in only for rows the feed didn't tag). `crossListed` is
    // import-time validation only — the catalog owns cross-listing, so the
    // sheet's claims are never stored; an imported group starts unowned (no
    // `crossListOwner`), and the first edit claims it.
    delete offering.crossListed
    byTerm[t].push(offering)
  }
  const written = {}
  for (const t of Object.keys(byTerm)) {
    if (setTermOfferings(scheduleId, t, byTerm[t])) written[t] = byTerm[t].length
  }
  return written
}

// A stable identity for a candidate row in the copy dialog's review list: the
// row's content `id` when it has one, else its code/section/lab/band, plus the
// row's position so exact duplicates still get distinct keys. The position
// makes keys order-dependent, which is fine — the candidate list is fixed while
// the user reviews it.
function copyCandidateKey(o, index) {
  const base =
    o && o.id
      ? `id:${o.id}`
      : `k:${o.prefix || ''}|${o.number || ''}|${o.section || ''}|${o.lab ? `L${o.labSeq || 0}` : ''}|${o.days || ''}|${o.time || ''}`
  return `${base}#${index}`
}

// The source rows a copy carries for `prefixes`: every row whose department
// prefix is selected, plus — when `includeSiblings` — the sibling versions of
// those codes that are present in the source (catalog cross-list groups).
function filterCopyRows(rows, prefixes, includeSiblings) {
  const want = new Set((prefixes || []).map((p) => String(p).toUpperCase()))
  const list = rows || []
  const out = []
  const chosen = new Set()
  for (const o of list) {
    if (!want.has(String(o.prefix || '').toUpperCase())) continue
    chosen.add(offeringCode(o))
    out.push(o)
  }
  if (!includeSiblings) return out
  const extra = []
  for (const code of chosen) {
    for (const sib of crossListOf(code)) {
      if (chosen.has(sib)) continue
      chosen.add(sib)
      for (const o of list) if (offeringCode(o) === sib) extra.push(o)
    }
  }
  return [...out, ...extra]
}

// The labels of selected lab rows whose lecture section isn't among them — a
// copy that would leave an orphan lab (kept, but flagged in the preview).
function copyOrphanLabs(rows) {
  const lectures = new Set()
  for (const o of rows || []) if (!o.lab) lectures.add(`${o.prefix}|${o.number}|${o.section}`)
  const out = []
  for (const o of rows || []) {
    if (o.lab && !lectures.has(`${o.prefix}|${o.number}|${o.section}`)) {
      out.push(`${o.prefix} ${o.number}L ${o.section}${o.labSeq || ''}`)
    }
  }
  return out
}

// The selected codes a non-owner's suggest session could not propose: outside
// the user's departments and not owned by one of them (the cross-list owner
// exception). The server would refuse the whole proposal, so the dialog warns.
function copyOutsideDeptCodes(rows) {
  if (editingRole.value !== 'suggest') return []
  const mine = new Set(myDepartments.value.map((d) => String(d).toUpperCase()))
  if (!mine.size) return []
  const out = new Set()
  for (const o of rows || []) {
    const prefix = String(o.prefix || '').toUpperCase()
    const owner = String(o.crossListOwner || '').toUpperCase()
    if (!mine.has(prefix) && !mine.has(owner)) out.add(`${o.prefix} ${o.number}`)
  }
  return [...out]
}

// Plans a bulk copy of another schedule's active-term offerings into `targetId`:
// the source rows matching `prefixes` (plus cross-list siblings when asked) are
// upserted onto the target's current active term. Pure read — returns the merged
// offerings plus counts and warnings for the dialog preview, or a zeroed plan
// when the source/target is missing or they are the same schedule.
//
// `candidates` is the full filtered row list (independent of the selection),
// each annotated with a stable `key`, display fields, and the `action` the copy
// will take ('added' | 'updated' | 'unchanged') — the dialog's review step. When
// `selectedKeys` is a non-null iterable, only those candidate keys are merged;
// passing null/undefined selects every candidate (the historical behavior).
/**
 * @param {string | number} targetId
 * @param {string | number} sourceId
 * @param {{ prefixes?: string[]; includeSiblings?: boolean; selectedKeys?: Iterable<string> | null }} [opts]
 */
export function planCourseCopy(
  targetId,
  sourceId,
  { prefixes = [], includeSiblings = false, selectedKeys = null } = {},
) {
  const empty = {
    added: 0,
    updated: 0,
    unchanged: 0,
    rows: 0,
    candidates: [],
    orphans: [],
    outside: [],
    offerings: null,
  }
  const target = scheduleById(targetId)
  const source = scheduleById(sourceId)
  if (!target || !source || String(target.id) === String(source.id)) return empty
  const term = activeTerm.value
  const part = viewPart(target, term)
  const base = (part && part.offerings) || []
  const sourcePart = source.terms && source.terms[term]
  const all = filterCopyRows((sourcePart && sourcePart.offerings) || [], prefixes, includeSiblings)
  const preview = mergeOfferings(base, all)
  const candidates = all.map((o, i) => ({
    key: copyCandidateKey(o, i),
    code: offeringCodeLabel(o),
    section: offeringSectionLabel(o),
    title: o.title || '',
    instructor: instructorName(o.instructor),
    days: o.days || '',
    time: o.time || '',
    action: preview.outcomes[i] || 'added',
  }))
  const keys = selectedKeys == null ? null : new Set(selectedKeys)
  const selected = keys ? all.filter((o, i) => keys.has(copyCandidateKey(o, i))) : all
  const plan = keys ? mergeOfferings(base, selected) : preview
  return {
    added: plan.added,
    updated: plan.updated,
    unchanged: plan.unchanged,
    rows: selected.length,
    candidates,
    orphans: copyOrphanLabs(selected),
    outside: copyOutsideDeptCodes(selected),
    offerings: plan.offerings,
  }
}

// Applies a planned copy to `targetId`'s active term. A no-op (null) when the
// plan can't be built or changes nothing; otherwise writes through
// `setTermOfferings` — the owner's direct write, or the suggest session's draft
// (where the server still enforces the department scope on propose). Returns the
// applied counts, or null when the write was refused.
/**
 * @param {string | number} targetId
 * @param {{ sourceId: string | number; prefixes?: string[]; includeSiblings?: boolean; selectedKeys?: Iterable<string> | null }} opts
 */
export function copyCoursesInto(
  targetId,
  { sourceId, prefixes = [], includeSiblings = false, selectedKeys = null },
) {
  const plan = planCourseCopy(targetId, sourceId, { prefixes, includeSiblings, selectedKeys })
  if (!plan.offerings) return null
  if (plan.added === 0 && plan.updated === 0) {
    return { added: 0, updated: 0, unchanged: plan.unchanged }
  }
  if (!setTermOfferings(targetId, activeTerm.value, plan.offerings)) return null
  return { added: plan.added, updated: plan.updated, unchanged: plan.unchanged }
}

// Removes a schedule and deselects it if it was visible. Remote: the server
// enforces ownership, so a non-owned schedule is left alone — a delete that
// silently resurrects on the next refresh is worse than no delete at all.
export function deleteSchedule(id) {
  const s = scheduleById(id)
  if (!s) return
  if (remote.value && !isOwner(s)) return
  schedules.value = schedules.value.filter((x) => x.id !== id)
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

// An item shown only as read-only context while a different schedule is being
// edited (a "reference"): a real offering that belongs to another schedule in
// the current view. Proposed-overlay items (`prop:…`) belong to the session
// itself, never a reference.
export function isReferenceItem(item) {
  const editing = editingScheduleId.value
  if (editing == null || !item || item.sid == null) return false
  const sid = item.sid
  if (typeof sid === 'string' && sid.startsWith('prop:')) return false
  return sid !== editing
}

// Reschedules a single offering of `scheduleId`'s active term into a standard
// slot. The `move` context is `{ fromDay, toDay, group, time }` (see
// `rescheduleDays`). `lab`/`labSeq` disambiguate a lab row from the lecture
// section it mirrors; `offeringId` (from the drag payload) targets the exact
// row when a sibling shares the section tuple (split meetings). No-op if the
// offering can't be found. In a suggest session the change lands in the draft
// instead of the published term.
export function moveOffering(id, prefix, number, section, move, lab = false, labSeq = 0, offeringId = '') {
  const s = scheduleById(id)
  if (!s) return false
  const { part, draft } = mutablePart(id)
  if (!part) return false
  const before = part.offerings || []
  const cur = { prefix, number, section, lab, labSeq, id: offeringId || undefined }
  const oldSource = before.find((o) => matchOffering(o, cur))
  let next = claimCrossListOwnership(before, cur)
  next = moveOfferingSmart(next, cur, move, activeTerm.value)
  // Keep a cross-listed group identical: the moved row's matching band in each
  // sibling version takes its new meeting days/time (split meetings stay
  // aligned band by band; never every row at the section).
  if (!lab) {
    const moved = next.find((o) => matchOffering(o, cur))
    if (moved) {
      const band = { days: oldSource?.days || '', time: oldSource?.time || '' }
      for (const sib of crossListBandSiblings(next, cur, band)) {
        next = updateOfferingInSchedule(next, sib, { days: moved.days, time: moved.time })
      }
    }
  }
  if (next === part.offerings || diffOfferings(before, next).length === 0) return false
  part.offerings = next
  recordHistory(part, before, id)
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
// (prefix/number/section) used to locate it; `changes` replaces the rest. A
// cross-list group edits as one: the same changes apply to the sibling versions,
// and an unowned imported group is claimed by this first edit. In a suggest
// session the change lands in the draft.
export function updateOffering(id, cur, changes) {
  const s = scheduleById(id)
  if (!s) return false
  const { part, draft } = mutablePart(id)
  if (!part) return false
  const before = part.offerings || []
  let next = claimCrossListOwnership(before, cur)
  const source = next.find((o) => matchOffering(o, cur))
  const siblings =
    !cur.lab && source && isCrossListed(offeringCode(cur))
      ? crossListBandSiblings(next, cur, { days: source.days || '', time: source.time || '' })
      : []
  next = updateOfferingInSchedule(next, cur, changes)
  for (const sib of siblings) next = updateOfferingInSchedule(next, sib, changes)
  // A save that rewrites nothing (the editor's "Save changes" on an untouched
  // course) must not bump the version or park a "no change" entry in history.
  if (next === part.offerings || diffOfferings(before, next).length === 0) return false
  part.offerings = next
  recordHistory(part, before, id)
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

// Adds a catalog course (by code) to the schedule's active term, landing it in
// the default slot with the first free section letter in the active term's
// range (Fall A–I, Winter J–R, Spring S–Z; doubled once the range is exhausted).
// A cross-listed course
// joins its group: if a sibling version is already on the term the new row
// adopts the sibling's section (when free) and copies its scheduling fields,
// keeping the group's owner (or staying unowned when it came from an import);
// otherwise the new row is the group's first version and owns it. Returns the
// merged edit-item ({ o, code, sid }) so the caller can open the course editor.
// In a suggest session the course lands in the draft.
export function addCourseToSchedule(id, code) {
  const s = scheduleById(id)
  if (!s) return null
  const { part, draft } = mutablePart(id)
  if (!part) return null
  const offerings = part.offerings || []
  const [prefix, number] = code.split(' ')
  // An existing version of a cross-listed group: adopt its section when free
  // and copy its scheduling fields.
  const siblingCodes = crossListOf(code)
  let existing = null
  for (const sibling of siblingCodes) {
    const [p, n] = sibling.split(' ')
    existing = offerings.find((o) => !o.lab && o.prefix === p && o.number === n) || null
    if (existing) break
  }
  const section =
    existing && sectionIsFree(offerings, prefix, number, existing.section)
      ? existing.section
      : nextSectionLetter(offerings, prefix, number, activeTerm.value)
  const offering = {
    prefix,
    number,
    section,
    title: existing ? existing.title || '' : '',
    instructor: existing ? existing.instructor || '' : '',
    secondaryInstructors: existing ? [...(existing.secondaryInstructors || [])] : [],
    days: existing ? existing.days : DEFAULT_SLOT.days,
    time: existing ? existing.time : DEFAULT_SLOT.time,
    seats: existing ? (existing.seats != null ? existing.seats : DEFAULT_SEATS) : DEFAULT_SEATS,
    id: '',
  }
  // The first version created owns the group; joining keeps its owner, and an
  // unowned (imported) group stays unowned until someone edits it.
  if (siblingCodes.length) {
    offering.crossListOwner = existing ? crossListOwnerOf(existing) : String(prefix).toUpperCase()
  }
  offering.id = offeringIdFor(offering)
  const before = part.offerings
  part.offerings = addOfferingToSchedule(offerings, offering)
  recordHistory(part, before, id)
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

// Adds a lab section for an existing lecture offering (`cur` — prefix/number/
// section of a non-lab row). The lab mirrors the lecture's section letter,
// copies the lecture's instructors (lead + secondary) as they stand right now,
// and starts unscheduled (no meeting time) so it lands in the "No meeting
// times" strip and is dragged onto a slot. `labSeq` is the next free one for
// that lecture, so a second lab on the same letter stays a distinct row.
//
// `cur` may also be a lab (its editor's "Add another lab section"): the new lab
// then duplicates that lab's meeting pattern (days/time) and instructor/seats,
// still attached to the same lecture and taking the next `labSeq`, so a
// scheduled lab spawns a scheduled sibling. Returns the new offering (or null
// when the lecture/source lab or schedule can't be found). In a suggest session
// the lab lands in the draft.
export function addLabSection(id, cur) {
  const s = scheduleById(id)
  if (!s) return null
  const { part, draft } = mutablePart(id)
  if (!part) return null
  const offerings = part.offerings || []
  // Duplicating a lab: find the row being copied first, so its (current)
  // section resolves the lecture it attaches to.
  const source = cur.lab ? offerings.find((o) => o.lab && matchOffering(o, cur)) || null : null
  if (cur.lab && !source) return null
  // Match the lecture by its content `id` when given (split-meeting rows),
  // else by the section tuple as before.
  const parent = offerings.find(
    (o) =>
      !o.lab &&
      (source
        ? o.prefix === source.prefix && o.number === source.number && o.section === source.section
        : cur.id != null && cur.id !== ''
          ? o.id === cur.id
          : o.prefix === cur.prefix && o.number === cur.number && o.section === cur.section),
  )
  if (!parent) return null
  const lab = {
    prefix: parent.prefix,
    number: parent.number,
    section: parent.section,
    title: parent.title || '',
    instructor: (source ? source.instructor : parent.instructor) || '',
    secondaryInstructors: [...((source ? source.secondaryInstructors : parent.secondaryInstructors) || [])],
    lab: true,
    labSeq: nextLabSeq(offerings, parent.prefix, parent.number, parent.section),
    days: source ? source.days || '' : '',
    time: source ? source.time || '' : '',
    seats: source && source.seats != null ? source.seats : DEFAULT_SEATS,
    id: '',
  }
  lab.id = offeringIdFor(lab)
  const before = offerings
  part.offerings = addOfferingToSchedule(offerings, lab)
  recordHistory(part, before, id)
  if (draft) {
    part.dirty = true
    touchDraft()
    return lab
  }
  part.version = (part.version || 0) + 1
  schedules.value = [...schedules.value]
  syncTerm(id)
  persistSchedules()
  return lab
}

// Adds a further meeting band to an existing lecture section as a same-section
// sibling row — split meetings are how one section carries different days/times
// (e.g. MW at one band, R at another). The new row starts unscheduled (blank
// days/time, so it lands in the "No meeting times" strip, matching a new lab)
// and copies the section's title / instructors / seats. A cross-listed group
// stays parallel: one mirror row is added per present sibling version (deduped
// by code), and an unowned group is claimed. Returns the created row for
// `cur`'s own code so the editor can switch to it, or null when `cur` names a
// lab or an unknown row. In a suggest session the row lands in the draft.
export function addMeetingToSchedule(id, cur) {
  const s = scheduleById(id)
  if (!s || !cur || cur.lab) return null
  const { part, draft } = mutablePart(id)
  if (!part) return null
  const offerings = part.offerings || []
  // Match the lecture by its content `id` when given (split-meeting rows), else
  // by the section tuple.
  const source = offerings.find((o) => !o.lab && matchOffering(o, cur))
  if (!source) return null
  // The present versions of the cross-listed group at this section, deduped by
  // code: the source row's code plus every sibling actually on the term.
  const codes = []
  for (const o of [source, ...crossListSiblingRows(offerings, source)]) {
    const code = offeringCode(o)
    if (code && !codes.includes(code)) codes.push(code)
  }
  // Claim an unowned group first, then read the owner the new rows carry.
  let list = claimCrossListOwnership(offerings, source)
  const stamped = list.find((o) => !o.lab && matchOffering(o, source)) || source
  const owner = crossListOwnerOf(stamped)
  let created = null
  for (const code of codes) {
    const [prefix, number] = code.split(' ')
    const row = {
      prefix,
      number,
      section: source.section,
      title: source.title || '',
      instructor: source.instructor || '',
      secondaryInstructors: [...(source.secondaryInstructors || [])],
      days: '',
      time: '',
      seats: source.seats != null ? source.seats : DEFAULT_SEATS,
      id: '',
    }
    if (isCrossListed(code)) row.crossListOwner = owner || String(prefix).toUpperCase()
    row.id = uniqueOfferingId(list, row)
    list = addOfferingToSchedule(list, row)
    if (code === offeringCode(source)) created = row
  }
  if (!created) return null
  const before = part.offerings
  part.offerings = list
  recordHistory(part, before, id)
  if (draft) {
    part.dirty = true
    touchDraft()
    return created
  }
  part.version = (part.version || 0) + 1
  schedules.value = [...schedules.value]
  syncTerm(id)
  persistSchedules()
  return created
}

// Removes the offering matching `cur` (its content `id` when present, else the
// section tuple) from the schedule's active term. For a split-meeting section
// (more than one lecture row for the row's code), this removes that one band
// across the group's versions and leaves the section's other meetings and its
// labs alone; a lab, or the section's last meeting, takes the existing path
// (removing the group owner's version removes the whole cross-listed group with
// its labs). Also closes the editor if the edited row was the one removed. In a
// suggest session the removal lands in the draft.
export function removeCourseFromSchedule(id, cur) {
  const s = scheduleById(id)
  if (!s) return false
  const { part, draft } = mutablePart(id)
  if (!part) return false
  const before = part.offerings || []
  const target = before.find((o) => matchOffering(o, cur))
  const ownCode = target ? offeringCode(target) : ''
  const meetingCount = before.filter(
    (o) => !o.lab && o.section === target?.section && offeringCode(o) === ownCode,
  ).length
  const isSplit = Boolean(target) && !target.lab && meetingCount > 1
  let next
  if (isSplit) {
    // One meeting band gone: drop the matching rows across every version of the
    // group (identified by code) at the section, keyed by the band's days/time
    // since content ids differ per version. Labs and other meetings survive.
    const codes = new Set([ownCode, ...crossListOf(ownCode)])
    next = before.filter(
      (o) =>
        o.lab ||
        o.section !== target.section ||
        !codes.has(offeringCode(o)) ||
        o.days !== target.days ||
        o.time !== target.time,
    )
  } else if (
    target &&
    !target.lab &&
    crossListOwnerOf(target) &&
    crossListOwnerOf(target) === String(target.prefix || '').toUpperCase()
  ) {
    // The owner's own version: take the whole group (same-section versions and
    // their labs) with it.
    const codes = new Set([offeringCode(target), ...crossListOf(offeringCode(target))])
    next = before.filter((o) => !(o.section === target.section && codes.has(offeringCode(o))))
  } else {
    next = removeOfferingFromSchedule(before, cur)
  }
  if (next === part.offerings) return false
  part.offerings = next
  recordHistory(part, before, id)
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
    // Clear only the exact row being removed — a split-meeting sibling at the
    // same section must keep the editor open.
    const sameRow =
      o.prefix === cur.prefix &&
      o.number === cur.number &&
      o.section === cur.section &&
      (cur.id == null || cur.id === '' || o.id === cur.id)
    if (sameRow) courseEditTarget.value = null
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

// The pending-suggestion overlay for the active term: the draw-on-top set from
// `overlaySuggestions`, gated by the toolbar toggle. `removalsByKey` lets a view
// mark a live course whose removal is proposed; `aware` distinguishes "showing
// nothing because the toggle is off / nothing pending" from a live overlay.
export const pendingOverlay = computed(() => {
  const empty = { proposed: [], removals: [], removalsByKey: new Map(), aware: false }
  if (!showPendingSuggestions.value) return empty
  const list = overlaySuggestions.value
  if (!list.length) return empty
  const scheduleOf = new Map(list.map((s) => [s.id, s.scheduleId]))
  const { proposed, removals } = proposeOverlay(scheduleOfferings.value, list)
  const removalsByKey = new Map()
  for (const r of removals) {
    removalsByKey.set(`${r.cur.prefix} ${r.cur.number} ${r.cur.section}`, r)
  }
  return {
    proposed: proposed.map((p) => ({ ...p, scheduleId: scheduleOf.get(p.suggestionId) })),
    removals,
    removalsByKey,
    aware: true,
  }
})

// The offerings every view draws: the base (published, or the suggest-session
// draft) plus each proposed offering, tagged (`$sid`/`$prop`) so views can style
// it and never treat it as a real, editable row.
export const shownOfferings = computed(() => {
  const extra = pendingOverlay.value.proposed
  if (!extra.length) return scheduleOfferings.value
  return [
    ...scheduleOfferings.value,
    ...extra.map((p, i) => ({
      ...p.offering,
      $sid: 'prop:' + p.suggestionId + ':' + i,
      $prop: {
        kind: p.kind,
        suggestionId: p.suggestionId,
        proposer: p.proposer,
        scheduleId: p.scheduleId,
      },
    })),
  ]
})

// The merged index over `shownOfferings` (base + proposals).
export const shownSchedule = computed(() =>
  shownOfferings.value === scheduleOfferings.value ? schedule.value : buildIndex(shownOfferings.value),
)

// The core-curriculum areas a course satisfies in this schedule collection: the
// union of the selected schedules' active-term offerings' own `coreReqs` (the
// imported registrar feed is the source of truth). An offering whose row carries
// no areas falls back to the catalog's mapping, so an untagged feed and
// schedules stored before the feed's areas were kept still resolve. Empty when
// the course isn't on any selected schedule.
export function scheduleAreasOf(code) {
  const want = String(code || '').trim()
  if (!want) return []
  const out = new Set()
  for (const o of scheduleOfferings.value) {
    if (o.lab) continue
    if (`${o.prefix || ''} ${o.number || ''}`.trim() !== want) continue
    const own = o.coreReqs && o.coreReqs.length ? o.coreReqs : coreReqsByCode.value.get(want) || []
    for (const id of own) out.add(id)
  }
  return [...out]
}

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
// compatibility; new records already carry `terms`. Offers missing a content
// `id` (records written before the id era) get deterministic ids on load, so
// split-meeting rows are distinguishable in diffs/history right away.
function normalizeStored(raw) {
  if (Array.isArray(raw.offerings)) {
    const terms = {}
    for (const t of TERM_KEYS)
      terms[t] = { offerings: assignOfferingIds(raw.offerings.map((o) => ({ ...o }))), version: 0 }
    return { id: raw.id, name: raw.name, year: raw.year || '', terms }
  }
  if (raw.terms) {
    const terms = {}
    for (const t of TERM_KEYS)
      terms[t] =
        raw.terms[t] && Array.isArray(raw.terms[t].offerings)
          ? {
              offerings: assignOfferingIds(raw.terms[t].offerings.map((o) => ({ ...o }))),
              version: raw.terms[t].version || 0,
            }
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
// otherwise populates from the freshly fetched sample schedule. An explicit
// delete-all (stored key present but empty) is respected — the sample returns
// only when the key has never been written.
function seedSchedules(seedList) {
  const stored = loadSchedules()
  const everStored = typeof window !== 'undefined' && localStorage.getItem(LS_SCHEDULES) !== null
  schedules.value = stored && stored.length ? stored : everStored ? [] : seedList.map(normalizeStored)
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
    const m = localStorage.getItem(LS_MODE)
    if (m && ['all', 'normal', 'custom'].includes(m)) blockMode.value = m
    const sc = localStorage.getItem(LS_SCALE)
    if (sc && ['auto', 'compact', 'tall'].includes(sc)) verticalScale.value = sc
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
  consumeAuthError()
  const config = await backend.fetchConfig()
  serverDetected.value = !!config
  authProvider.value = (config && config.auth && config.auth.provider) || 'username'
  if (!config || localStorage.getItem(LS_OFFLINE) === '1') {
    setRemote(false)
    seedSampleSchedule()
    collectionReady.value = true
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
  const m = localStorage.getItem(LS_MODE)
  if (m && ['all', 'normal', 'custom'].includes(m)) blockMode.value = m
  const sc = localStorage.getItem(LS_SCALE)
  if (sc && ['auto', 'compact', 'tall'].includes(sc)) verticalScale.value = sc
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
