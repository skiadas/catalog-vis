import {
  buildIndex,
  moveOfferingSmart,
  updateOfferingInSchedule,
  DEFAULT_SLOT,
  nextSectionLetter,
  addOfferingToSchedule,
  removeOfferingFromSchedule,
} from './schedule.js'

const { ref, computed } = Vue

// ---- Schedule collection state ------------------------------------------
// Schedules are named, editable collections of offerings, persisted to
// localStorage. Any subset may be displayed at once; the merged, indexed view
// (`schedule` / `scheduleOfferings`) is derived below. This layers naturally onto
// future editing/creation workflows.

export const schedules = ref([])
export const selectedScheduleIds = ref([])

// Whether to color courses by schedule when multiple schedules are shown and no
// department/instructor filter is active. Off by default (grid shows clean count
// summaries); can be toggled on to see each schedule's actual course list.
// Persisted locally.
export const colorSchedules = ref(false)

// The schedule currently being edited, or null. In edit mode the schedule's
// courses can be dragged onto the grid's standard time slots to be rescheduled.
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

export function setColorSchedules(v) {
  colorSchedules.value = !!v
  if (typeof window !== 'undefined') localStorage.setItem(LS_COLOR, colorSchedules.value ? '1' : '0')
}

export function scheduleById(id) {
  return schedules.value.find((s) => s.id === id) || null
}

function scheduleId() {
  return 'sched_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// Adds a schedule (offerings in parseCsv shape) and selects it.
export function addSchedule(name, offerings) {
  const schedule = { id: scheduleId(), name, offerings }
  schedules.value = [...schedules.value, schedule]
  selectedScheduleIds.value = [...selectedScheduleIds.value, schedule.id]
  persistSchedules()
  persistSelectedSchedules()
  return schedule.id
}

// Removes a schedule and deselects it if it was visible.
export function deleteSchedule(id) {
  schedules.value = schedules.value.filter((s) => s.id !== id)
  selectedScheduleIds.value = selectedScheduleIds.value.filter((x) => x !== id)
  if (editingScheduleId.value === id) editingScheduleId.value = null
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
  persistSchedules()
  return true
}

// Duplicates a schedule (deep-copied offerings) under an auto-generated name and
// selects it. Returns the new schedule's id, or null if the source is missing.
export function duplicateSchedule(id) {
  const s = scheduleById(id)
  if (!s) return null
  const copy = {
    id: scheduleId(),
    name: s.name + ' (copy)',
    offerings: (s.offerings || []).map((o) => ({ ...o })),
  }
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

// Reschedules a single offering of `scheduleId` into a standard slot. The
// `move` context is `{ fromDay, toDay, group, time }` where `group` is the
// target slot's day group ("MWF"/"TR") and `time` one of the SLOT_BLOCKS times;
// the target `days` are recomputed from the drag context (see `rescheduleDays`).
// No-op if the offering can't be found.
export function moveOffering(id, prefix, number, section, move) {
  const s = scheduleById(id)
  if (!s) return false
  const next = moveOfferingSmart(s.offerings, { prefix, number, section }, move)
  if (next === s.offerings) return false
  scheduleById(id).offerings = next
  schedules.value = [...schedules.value]
  persistSchedules()
  return true
}

// Rewrites an offering's editable fields (instructor / section / days / time).
// `cur` is the offering's current identity (prefix/number/section) used to
// locate it; `changes` replaces the rest. No-op if it can't be found.
export function updateOffering(id, cur, changes) {
  const s = scheduleById(id)
  if (!s) return false
  const next = updateOfferingInSchedule(s.offerings, cur, changes)
  if (next === s.offerings) return false
  scheduleById(id).offerings = next
  schedules.value = [...schedules.value]
  persistSchedules()
  return true
}

// Adds a brand-new catalog course (by code) to a schedule, landing it in the
// default slot with the first free section letter. Returns the merged edit-item
// ({ o, code, sid }) so the caller can open the course editor, or null if the
// schedule can't be found.
export function addCourseToSchedule(id, code) {
  const s = scheduleById(id)
  if (!s) return null
  const [prefix, number] = code.split(' ')
  const section = nextSectionLetter(s.offerings, prefix, number)
  const offering = { prefix, number, section, instructor: '', ...DEFAULT_SLOT }
  scheduleById(id).offerings = addOfferingToSchedule(s.offerings, offering)
  schedules.value = [...schedules.value]
  persistSchedules()
  return { o: offering, code, sid: id }
}

// Removes the offering matching `cur` (prefix/number/section) from a schedule.
// Also closes the editor if the edited course was the one removed. No-op if the
// offering can't be found.
export function removeCourseFromSchedule(id, cur) {
  const s = scheduleById(id)
  if (!s) return false
  const next = removeOfferingFromSchedule(s.offerings, cur)
  if (next === s.offerings) return false
  scheduleById(id).offerings = next
  schedules.value = [...schedules.value]
  persistSchedules()
  if (courseEditTarget.value) {
    const o = courseEditTarget.value.o
    if (o.prefix === cur.prefix && o.number === cur.number && o.section === cur.section) {
      courseEditTarget.value = null
    }
  }
  return true
}

// Merged raw offerings across the selected schedules, tagged with their source id.
export const scheduleOfferings = computed(() => {
  if (!schedules.value.length) return []
  const sel = new Set(selectedScheduleIds.value)
  const out = []
  for (const s of schedules.value) {
    if (!sel.has(s.id)) continue
    for (const o of s.offerings) out.push({ ...o, $sid: s.id })
  }
  return out
})

// The merged index over the selected schedules.
export const schedule = computed(() => buildIndex(scheduleOfferings.value))

function persistSchedules() {
  if (typeof window === 'undefined') return
  localStorage.setItem(LS_SCHEDULES, JSON.stringify(schedules.value))
}
function persistSelectedSchedules() {
  if (typeof window === 'undefined') return
  localStorage.setItem(LS_SELECTED, JSON.stringify(selectedScheduleIds.value))
}
function loadSchedules() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LS_SCHEDULES)
    const arr = raw ? JSON.parse(raw) : null
    if (Array.isArray(arr) && arr.length && arr.every((s) => s && Array.isArray(s.offerings))) return arr
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
// otherwise populates from the freshly fetched sample schedule. A fresh user sees
// only the Sample schedule (the pre-existing single schedule users already see)
// selected by default; additional schedules are generated on demand.
export function seedSchedules(seedList) {
  const stored = loadSchedules()
  schedules.value = stored && stored.length ? stored : seedList
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
  }
}
