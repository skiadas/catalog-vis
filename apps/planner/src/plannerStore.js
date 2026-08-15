// Planner app store: plans, year x term timeline slots, and added tracks.
//
// Persists to localStorage (`major-vis.planner.*`) and depends on the catalog
// data layer (`@major-vis/catalog-client`) for programs/requirements/core.
// The pure evaluation happens in `@major-vis/degree-audit`, called by the
// planner components — this store holds only the user's plan state.

import {
  programs,
  parsedRequirements,
  coreRequirements,
  CORE_ID,
  CORE_TRACK,
  CORE_LABEL,
  trackSlug,
} from '@major-vis/catalog-client'

export { CORE_ID, CORE_TRACK, programTracks } from '@major-vis/catalog-client'

const { ref, computed } = Vue

export const PLAN_SLOT_KEYS = [
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

// The core curriculum is modeled as a planner-only "program" — not part of the
// browseable catalog (`programs`) — but appears in the planner's add-track
// picker. It is a single addable track ("General Degree Requirements") whose
// sections are the CCR/ACE areas; its requirement is marked `independentSections`
// so a course can satisfy several areas at once (e.g. `ENG 172` is both LA and
// W1). It is present by default on newly created plans.
const coreProgram = { id: CORE_ID, name: 'Core Curriculum', type: [] }

const LS_PLANS = 'major-vis.planner.plans'
const LS_ACTIVE = 'major-vis.planner.active'

function emptySlots() {
  const slots = {}
  for (const key of PLAN_SLOT_KEYS) slots[key] = []
  return slots
}

function cloneSlots(slots) {
  const out = emptySlots()
  for (const key of PLAN_SLOT_KEYS) out[key] = [...(slots?.[key] || [])]
  return out
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// Coalesces any core-curriculum tracks into the single core track (legacy saved
// plans may carry per-area core tracks from an earlier model).
function normalizeTracks(tracks) {
  const hasCore = (tracks || []).some((t) => t.programId === CORE_ID)
  const rest = (tracks || []).filter((t) => t.programId !== CORE_ID)
  return hasCore ? [{ programId: CORE_ID, trackKey: CORE_TRACK }, ...rest] : rest
}

export const plans = ref([])
export const currentPlanId = ref(null)
export const currentName = ref('')
export const planSlots = ref(emptySlots())

export const currentPlan = computed(() => plans.value.find((p) => p.id === currentPlanId.value) || null)

// Union of every slot's codes — what the planner treats as "taken". Timing is
// organizational; the requirements evaluator only ever sees this set, so the
// degree-audit engine is unchanged.
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
  addedTracks.value = normalizeTracks(p.tracks || [])
  persist()
}

export function newPlan(name = 'Untitled Plan') {
  const id = makeId()
  const tracks = [{ programId: CORE_ID, trackKey: CORE_TRACK }]
  const p = { id, name, slots: emptySlots(), tracks }
  plans.value = [...plans.value, p]
  currentPlanId.value = id
  currentName.value = name
  planSlots.value = emptySlots()
  addedTracks.value = tracks
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
  addedTracks.value = normalizeTracks(copy.tracks)
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
export function movePlanCourse(code, toKey, fromKey) {
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
  movePlanCourse(code, 'unassigned')
}

export function removePlanCourse(code) {
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
      if (t.programId === CORE_ID) {
        if (!coreRequirements.value.length) return null
        // One track whose sections are the CCR/ACE areas. Each electives node is
        // tagged with its area code so the "still need" message reads e.g.
        // "Need 2 more from LA" instead of the full eligible-course list.
        const sections = coreRequirements.value.map((r) => {
          const src = (r.sections || [])[0] || { heading: r.label, items: [] }
          return {
            heading: r.label,
            items: (src.items || []).map((it) => ({
              ...it,
              ...(it.type === 'electives' ? { label: r.id } : {}),
            })),
          }
        })
        const requirement = { label: CORE_LABEL, sections, independentSections: true }
        return { ...t, program: coreProgram, requirement }
      }
      const program = programs.value.find((p) => p.id === t.programId)
      const parsed = parsedRequirements.value[t.programId] || []
      const requirement = parsed.find((req) => trackSlug(req.label) === t.trackKey) || parsed[0] || null
      const track = { ...t, program, requirement }
      return program && requirement ? track : null
    })
    .filter(Boolean),
)

// Programs shown in the planner's add-track picker: the core curriculum plus
// every browseable program.
export const plannerPrograms = computed(() => [coreProgram, ...programs.value])

// Initialize planner state after all refs (incl. addedTracks) are declared.
if (typeof window !== 'undefined') initPlanner()
