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

// ---- Planner state (session-only) ----------------------------------------

// Global set of courses the user has "taken", shared across programs so a
// major + minor can be audited together. Session-only for now.
export const takenCourses = ref([])
export const takenSet = computed(() => new Set(takenCourses.value))

export function toggleTaken(code) {
  const i = takenCourses.value.indexOf(code)
  if (i === -1) takenCourses.value = [...takenCourses.value, code]
  else takenCourses.value = takenCourses.value.filter((c) => c !== code)
}

export function resetTaken() {
  takenCourses.value = []
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
}

export function addProgramTracks(programId) {
  const existing = new Set(addedTracks.value.map((t) => `${t.programId}:${t.trackKey}`))
  const fresh = programTracks(programId).filter((t) => !existing.has(`${t.programId}:${t.trackKey}`))
  if (fresh.length) {
    addedTracks.value = [
      ...addedTracks.value,
      ...fresh.map((t) => ({ programId: t.programId, trackKey: t.trackKey })),
    ]
  }
}

export function clearTracks() {
  addedTracks.value = []
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
