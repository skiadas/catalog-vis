import { parseCsv, buildIndex } from './schedule.js'

const { ref, computed } = Vue

export const programs = ref([])
export const allCourses = ref({})
export const parsedRequirements = ref({})
export const loading = ref(true)
export const searchQuery = ref('')
export const filterType = ref('all')

export const scheduleOfferings = ref([])
export const schedule = ref(null)
export const selectedDepartments = ref([])
export const selectedInstructors = ref([])
export const filterMode = ref('dept')

// ---- Planner state --------------------------------------------------------
// Courses are organized on a year x term timeline (4 years, Fall/Winter/Spring)
// plus a transfer-credit bucket, with an "unassigned" shelf for courses not yet
// dragged into a cell. Plans autosave to localStorage; multiple named plans are
// kept and can be loaded/renamed/deleted.

export const SLOT_KEYS = [
  'y1f',
  'y1w',
  'y1s',
  'y2f',
  'y2w',
  'y2s',
  'y3f',
  'y3w',
  'y3s',
  'y4f',
  'y4w',
  'y4s',
  'transfer',
  'unassigned',
]

const LS_PLANS = 'major-vis.planner.plans'
const LS_ACTIVE = 'major-vis.planner.active'

function emptySlots() {
  const slots = {}
  for (const key of SLOT_KEYS) slots[key] = []
  return slots
}

function cloneSlots(slots) {
  const out = emptySlots()
  for (const key of SLOT_KEYS) out[key] = [...(slots?.[key] || [])]
  return out
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export const plans = ref([])
export const currentPlanId = ref(null)
export const currentName = ref('')
export const planSlots = ref(emptySlots())

export const currentPlan = computed(() => plans.value.find((p) => p.id === currentPlanId.value) || null)

// Union of every slot's codes — what the planner treats as "taken". Timing is
// organizational; the requirements evaluator only ever sees this set, so
// lib/planner.js is unchanged.
export const takenSet = computed(() => new Set(Object.values(planSlots.value).flat()))
export const takenCourses = computed(() => [...takenSet.value])

function persist() {
  if (typeof window === 'undefined') return
  localStorage.setItem(LS_PLANS, JSON.stringify(plans.value))
  localStorage.setItem(LS_ACTIVE, currentPlanId.value || '')
}

function autosave() {
  const p = currentPlan.value
  if (!p) return
  p.slots = cloneSlots(planSlots.value)
  p.tracks = addedTracks.value.map((t) => ({ programId: t.programId, trackKey: t.trackKey }))
  persist()
}

export function setName(name) {
  currentName.value = name
  const p = currentPlan.value
  if (p) {
    p.name = name
    persist()
  }
}

export function loadPlan(id) {
  const p = plans.value.find((x) => x.id === id)
  if (!p) return
  currentPlanId.value = id
  currentName.value = p.name
  planSlots.value = cloneSlots(p.slots)
  addedTracks.value = (p.tracks || []).map((t) => ({ programId: t.programId, trackKey: t.trackKey }))
  persist()
}

export function newPlan(name = 'Untitled Plan') {
  const id = makeId()
  const p = { id, name, slots: emptySlots(), tracks: [] }
  plans.value = [...plans.value, p]
  currentPlanId.value = id
  currentName.value = name
  planSlots.value = emptySlots()
  addedTracks.value = []
  persist()
}

export function duplicatePlan() {
  const p = currentPlan.value
  if (!p) return
  const id = makeId()
  const copy = {
    id,
    name: p.name + ' (copy)',
    slots: cloneSlots(p.slots),
    tracks: (p.tracks || []).map((t) => ({ programId: t.programId, trackKey: t.trackKey })),
  }
  plans.value = [...plans.value, copy]
  currentPlanId.value = id
  currentName.value = copy.name
  planSlots.value = cloneSlots(copy.slots)
  addedTracks.value = [...copy.tracks]
  persist()
}

export function deletePlan() {
  const idx = plans.value.findIndex((p) => p.id === currentPlanId.value)
  if (idx === -1) return
  plans.value = plans.value.filter((_, i) => i !== idx)
  if (plans.value.length) loadPlan(plans.value[0].id)
  else newPlan()
}

function slotOf(code) {
  for (const key of Object.keys(planSlots.value)) {
    if ((planSlots.value[key] || []).includes(code)) return key
  }
  return null
}

// Places `code` into `toKey`, removing it from wherever it currently lives
// (`fromKey` when supplied by a drag, otherwise its current slot).
export function moveCourse(code, toKey, fromKey) {
  const src = fromKey && (planSlots.value[fromKey] || []).includes(code) ? fromKey : slotOf(code)
  if (toKey === src) return
  const next = { ...planSlots.value }
  if (src) next[src] = next[src].filter((c) => c !== code)
  next[toKey] = [...(next[toKey] || []), code]
  planSlots.value = next
  autosave()
}

// Adds a course to the plan, landing on the unassigned shelf.
export function placeCourse(code) {
  moveCourse(code, 'unassigned')
}

export function removeCourse(code) {
  const src = slotOf(code)
  if (!src) return
  planSlots.value = {
    ...planSlots.value,
    [src]: planSlots.value[src].filter((c) => c !== code),
  }
  autosave()
}

export function initPlanner() {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(LS_PLANS)
    const arr = raw ? JSON.parse(raw) : []
    plans.value = Array.isArray(arr) ? arr.filter((p) => p && p.id && typeof p.slots === 'object') : []
  } catch {
    plans.value = []
  }
  const active = localStorage.getItem(LS_ACTIVE)
  if (plans.value.some((p) => p.id === active)) {
    loadPlan(active)
  } else if (plans.value.length) {
    loadPlan(plans.value[0].id)
  } else {
    newPlan('My Plan')
  }
}

// A program's addable planner units are its "tracks" — one per parsed
// requirement, keyed by the majors.json requirements slug. A track is
// `{ programId, trackKey, label }`.
export function programTracks(programId) {
  const program = programs.value.find((p) => p.id === programId)
  const parsed = parsedRequirements.value[programId] || []
  if (!program || !parsed.length) return []
  const keys = Object.keys(program.requirements || {})
  return parsed.map((req, i) => ({
    programId,
    trackKey: keys[i] || `track_${i}`,
    label: req.label,
  }))
}

// List of tracks the user has added to their plan.
export const addedTracks = ref([])

export function toggleTrack(programId, trackKey) {
  const i = addedTracks.value.findIndex((t) => t.programId === programId && t.trackKey === trackKey)
  if (i === -1) addedTracks.value = [...addedTracks.value, { programId, trackKey }]
  else addedTracks.value = addedTracks.value.filter((_, j) => j !== i)
  autosave()
}

// Adds just one track (no-op if already present).
export function addTrack(programId, trackKey) {
  const exists = addedTracks.value.some((t) => t.programId === programId && t.trackKey === trackKey)
  if (!exists) addedTracks.value = [...addedTracks.value, { programId, trackKey }]
  autosave()
}

// Removes just one track from the plan.
export function removeTrack(programId, trackKey) {
  addedTracks.value = addedTracks.value.filter((t) => !(t.programId === programId && t.trackKey === trackKey))
  autosave()
}

export function clearTracks() {
  addedTracks.value = []
  autosave()
}

// Resolves each added track to its program + parsed requirement (for the audit).
export const addedTracksDetailed = computed(() =>
  addedTracks.value
    .map((t) => {
      const program = programs.value.find((p) => p.id === t.programId)
      const parsed = parsedRequirements.value[t.programId] || []
      const keys = Object.keys((program && program.requirements) || {})
      const index = keys.indexOf(t.trackKey)
      const requirement = index >= 0 && parsed[index] ? parsed[index] : parsed[0] || null
      const track = { ...t, program, requirement }
      return program && requirement ? track : null
    })
    .filter(Boolean),
)

export async function loadData() {
  try {
    const [majorsRes, parsedRes, scheduleRes] = await Promise.all([
      fetch('majors.json'),
      fetch('requirements_parsed.json'),
      fetch('sample-schedule.csv'),
    ])
    const majorsData = await majorsRes.json()
    programs.value = majorsData.programs
    const map = {}
    // The global catalog (every API course, incl. cross-listed and orphan codes
    // that appear in no single program's list) seeds the universe first so the
    // planner can resolve HF/SMGT/cross-listed courses; per-program courses then
    // fill in richer detail where available.
    for (const code in majorsData.catalog || {}) {
      map[code] = majorsData.catalog[code]
    }
    for (const p of majorsData.programs) {
      for (const c of p.courses) {
        map[c.course_code] = c
      }
    }
    allCourses.value = map
    const parsedData = await parsedRes.json()
    const parsedMap = {}
    for (const p of parsedData.programs) {
      parsedMap[p.id] = p.requirements
    }
    parsedRequirements.value = parsedMap
    const scheduleText = await scheduleRes.text()
    scheduleOfferings.value = parseCsv(scheduleText)
    schedule.value = buildIndex(scheduleOfferings.value)
  } catch (err) {
    console.error('Failed to load data:', err)
  } finally {
    loading.value = false
  }
}

export function programsUsingCourse(courseCode) {
  return programs.value
    .filter((p) => p.courses.some((c) => c.course_code === courseCode))
    .map((p) => ({ program: p }))
}

export const filteredPrograms = computed(() => {
  let list = programs.value
  if (filterType.value !== 'all') {
    list = list.filter((p) => p.type.includes(filterType.value))
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || (p.course_prefix && p.course_prefix.toLowerCase().includes(q)),
    )
  }
  return list
})

// Initialize planner state after all refs (incl. addedTracks) are declared.
if (typeof window !== 'undefined') initPlanner()
