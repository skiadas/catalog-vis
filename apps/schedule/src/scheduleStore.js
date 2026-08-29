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
import { diffOfferings } from '@major-vis/schedule-core/diff'
import * as backend from './backend.js'

import { ref, computed } from 'vue'

export const selectedDepartments = ref([])
export const selectedInstructors = ref([])
export const filterMode = ref('dept')

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

// Whether to color courses by schedule when multiple schedules are shown and no
// department/instructor filter is active. Off by default (grid shows clean count
// summaries); can be toggled on to see each schedule's actual course list.
// Persisted locally.
export const colorSchedules = ref(false)

// The schedule currently being edited, or null. In edit mode the schedule's
// active-term courses can be dragged onto the grid's standard time slots to be
// rescheduled.
export const editingScheduleId = ref(null)

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

export function setColorSchedules(v) {
  colorSchedules.value = !!v
  if (typeof window !== 'undefined') localStorage.setItem(LS_COLOR, colorSchedules.value ? '1' : '0')
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

// Whether the supplied schedule is owned by the current user.
export function isOwner(schedule) {
  if (!currentUser.value || !schedule) return false
  if (schedule.owner_user_id == null) return false
  return Number(schedule.owner_user_id) === Number(currentUser.value.id)
}

// Pending/processed suggestions for the currently-viewed schedule (remote only).
export const suggestions = ref([])

export async function refreshSuggestions(scheduleId) {
  if (!remote.value || typeof window === 'undefined') {
    suggestions.value = []
    return []
  }
  const list = await backend.fetchSuggestions(scheduleId)
  suggestions.value = list
  return list
}

export async function approveSuggestion(id) {
  if (!(await backend.approveSuggestion(id))) return false
  suggestions.value = suggestions.value.map((s) => (s.id === id ? { ...s, status: 'approved' } : s))
  return true
}

export async function rejectSuggestion(id) {
  if (!(await backend.rejectSuggestion(id))) return false
  suggestions.value = suggestions.value.map((s) => (s.id === id ? { ...s, status: 'rejected' } : s))
  return true
}

// Submits a proposed change for a term part as a suggestion. `newOfferings` is
// the desired offering list; the server's current term is fetched so the
// suggestion carries the right base version, and the diff (add/remove/update)
// is computed here via schedule-core. Returns the created suggestion or null.
export async function submitTermSuggestion(scheduleId, term, newOfferings, note) {
  if (!remote.value || typeof window === 'undefined') return null
  const current = await backend.fetchTerm(scheduleId, term)
  if (!current) return null
  const operations = diffOfferings(current.offerings || [], newOfferings || [])
  if (!operations.length) return null
  return backend.createSuggestion(scheduleId, {
    term,
    baseVersion: current.version,
    operations,
    note: note || '',
  })
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
  const part = s && s.terms[term]
  if (!part) return
  if (isOwner(s)) backend.replaceTerm(id, term, part.offerings)
}

// The term part of a schedule, defaulting to an empty part. `term` defaults to
// the active term; explicit (year, term) lookups are used by the year picker.
export function termPart(schedule, term = activeTerm.value) {
  if (!schedule) return null
  const part = (schedule.terms || {})[term]
  return part || { offerings: [], version: 0 }
}

// Offerings of a schedule's term part (identity shape: prefix/number/section).
export function termOfferings(schedule, term = activeTerm.value) {
  const part = termPart(schedule, term)
  return part ? part.offerings : []
}

// Adds a schedule, creating its three empty term parts. `offerings` (optional)
// seeds the active term part. Selects the schedule and returns its id.
export function addSchedule(name, year, offerings) {
  if (remote.value) {
    const optimistic = { id: scheduleId(), name, year, terms: emptyTerms() }
    if (offerings) optimistic.terms[activeTerm.value].offerings = [...offerings]
    schedules.value = [...schedules.value, optimistic]
    selectedScheduleIds.value = [...selectedScheduleIds.value, optimistic.id]
    persistSelectedSchedules()
    backend.createSchedule({ name, year }).then((srv) => {
      if (!srv) return
      // Replace the optimistic entry with the server-owned one; seed offerings.
      const idx = schedules.value.findIndex((x) => x.id === optimistic.id)
      if (idx >= 0) {
        schedules.value[idx] = srv
        schedules.value = [...schedules.value]
        selectedScheduleIds.value = selectedScheduleIds.value.map((x) => (x === optimistic.id ? srv.id : x))
        if (offerings && offerings.length) setTermOfferings(srv.id, activeTerm.value, offerings)
        persistSelectedSchedules()
      } else {
        schedules.value = [...schedules.value, srv]
      }
    })
    return optimistic.id
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
// generation, or a full-term paste), bumping its version.
export function setTermOfferings(id, term, offerings) {
  const s = scheduleById(id)
  if (!s) return false
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
  if (editingScheduleId.value === id) editingScheduleId.value = null
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
// and selects it. Returns the new schedule's id, or null if the source is missing.
export function duplicateSchedule(id) {
  const s = scheduleById(id)
  if (!s) return null
  const terms = {}
  for (const t of TERM_KEYS) {
    terms[t] = {
      offerings: (s.terms[t]?.offerings || []).map((o) => ({ ...o })),
      version: s.terms[t]?.version || 0,
    }
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

// The schedule being edited (null if not in edit mode).
export const editingSchedule = computed(() =>
  editingScheduleId.value ? scheduleById(editingScheduleId.value) : null,
)

// Enters/starts edit mode for `id`, or exits when `id` is null/falsy.
export function setEditingSchedule(id) {
  const target = id ? scheduleById(id) : null
  editingScheduleId.value = target ? target.id : null
}

// Reschedules a single offering of `scheduleId`'s active term into a standard
// slot. The `move` context is `{ fromDay, toDay, group, time }` (see
// `rescheduleDays`). No-op if the offering can't be found.
export function moveOffering(id, prefix, number, section, move) {
  const s = scheduleById(id)
  if (!s) return false
  const part = s.terms[activeTerm.value]
  const next = moveOfferingSmart(part.offerings, { prefix, number, section }, move, activeTerm.value)
  if (next === part.offerings) return false
  part.offerings = next
  part.version = (part.version || 0) + 1
  schedules.value = [...schedules.value]
  syncTerm(id)
  persistSchedules()
  return true
}

// Rewrites an offering's editable fields (instructor / section / days / time)
// in the schedule's active term. `cur` is the offering's current identity
// (prefix/number/section) used to locate it; `changes` replaces the rest.
export function updateOffering(id, cur, changes) {
  const s = scheduleById(id)
  if (!s) return false
  const part = s.terms[activeTerm.value]
  const next = updateOfferingInSchedule(part.offerings, cur, changes)
  if (next === part.offerings) return false
  part.offerings = next
  part.version = (part.version || 0) + 1
  schedules.value = [...schedules.value]
  syncTerm(id)
  persistSchedules()
  return true
}

// Adds a brand-new catalog course (by code) to the schedule's active term,
// landing it in the default slot with the first free section letter. Returns the
// merged edit-item ({ o, code, sid }) so the caller can open the course editor.
export function addCourseToSchedule(id, code) {
  const s = scheduleById(id)
  if (!s) return null
  const part = s.terms[activeTerm.value]
  const [prefix, number] = code.split(' ')
  const section = nextSectionLetter(part.offerings, prefix, number)
  const offering = { prefix, number, section, instructor: '', ...DEFAULT_SLOT }
  part.offerings = addOfferingToSchedule(part.offerings, offering)
  part.version = (part.version || 0) + 1
  schedules.value = [...schedules.value]
  syncTerm(id)
  persistSchedules()
  return { o: offering, code, sid: id }
}

// Removes the offering matching `cur` (prefix/number/section) from the
// schedule's active term. Also closes the editor if the edited course was the
// one removed.
export function removeCourseFromSchedule(id, cur) {
  const s = scheduleById(id)
  if (!s) return false
  const part = s.terms[activeTerm.value]
  const next = removeOfferingFromSchedule(part.offerings, cur)
  if (next === part.offerings) return false
  part.offerings = next
  part.version = (part.version || 0) + 1
  schedules.value = [...schedules.value]
  syncTerm(id)
  persistSchedules()
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
    for (const o of termOfferings(s, activeTerm.value)) out.push({ ...o, $sid: s.id })
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
  }
}

// Bootstraps the collection. When the app is served by the major-vis backend it
// loads the shared schedule list from the API; otherwise it seeds the local
// sample schedule. Call after `loadCatalog` (it consults the catalog for the
// sample generation).
export async function initScheduleCollection() {
  if (typeof window === 'undefined') return
  const isRemote = await backend.detectRemote()
  setRemote(isRemote)
  if (isRemote) {
    await loadCurrentUser()
    const list = await backend.fetchSchedules()
    if (list) {
      schedules.value = list
      const selected = loadSelectedSchedules()
      const valid = (sel) =>
        Array.isArray(sel) && sel.filter((id) => schedules.value.some((s) => s.id === id)).length > 0
      if (valid(selected)) {
        selectedScheduleIds.value = selected.filter((id) => schedules.value.some((s) => s.id === id))
      } else {
        selectedScheduleIds.value = schedules.value.length ? [schedules.value[0].id] : []
        persistSelectedSchedules()
      }
      restoreAux()
      return
    }
  }
  seedSampleSchedule()
}

function restoreAux() {
  if (typeof window === 'undefined') return
  const c = localStorage.getItem(LS_COLOR)
  if (c !== null) colorSchedules.value = c === '1'
  const t = localStorage.getItem(LS_TERM)
  if (t && TERM_KEYS.includes(t)) activeTerm.value = t
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
// offerings seed the schedule's active term.
/**
 * @param {{ mode: 'random' | 'dept' | 'empty'; dept?: string | null; name?: string; year?: string }} [opts]
 */
export function generateSchedule(
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
