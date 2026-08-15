// Shared browser catalog data layer.
//
// Loads the three catalog artifacts (majors.json, requirements_parsed.json,
// core_requirements.json) into Vue-reactive refs and derives browse filters.
// This is the read-only data contract all apps consume; the college catalog
// API plugs in here via `loadCatalog`'s `baseUrl`.
//
// Depends on the Vue global (CDN) — the same pattern as the app views.

const { ref, computed } = Vue

export const programs = ref([])
export const allCourses = ref({})
export const parsedRequirements = ref({})
export const coreRequirements = ref([])
export const loading = ref(true)
export const searchQuery = ref('')
export const filterType = ref('all')

// Fetches the catalog artifacts and populates the shared refs. `baseUrl` is
// the seam for pointing an app at a different catalog source (a college-hosted
// API or another host); `files` overrides the per-artifact paths.
export async function loadCatalog({ baseUrl = '', files } = {}) {
  const paths = files || {
    majors: 'majors.json',
    parsed: 'requirements_parsed.json',
    core: 'core_requirements.json',
  }
  try {
    const [majorsRes, parsedRes, coreRes] = await Promise.all([
      fetch(baseUrl + paths.majors),
      fetch(baseUrl + paths.parsed),
      fetch(baseUrl + paths.core),
    ])
    const majorsData = await majorsRes.json()
    programs.value = majorsData.programs
    // The global catalog (every API course, incl. cross-listed and orphan codes
    // that appear in no single program's list) seeds the universe first so the
    // planner can resolve HF/SMGT/cross-listed courses; per-program courses then
    // fill it in richer detail where available.
    const map = {}
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
    const coreData = await coreRes.json()
    coreRequirements.value = ((coreData.programs || [])[0] || {}).requirements || []
  } catch (err) {
    console.error('Failed to load catalog data:', err)
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
