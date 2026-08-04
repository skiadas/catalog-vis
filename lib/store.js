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
