const { ref, computed } = Vue

export const programs = ref([])
export const allCourses = ref({})
export const loading = ref(true)
export const searchQuery = ref('')
export const filterType = ref('all')

export async function loadData() {
  try {
    const res = await fetch('majors.json')
    const data = await res.json()
    programs.value = data.programs
    const map = {}
    for (const p of data.programs) {
      for (const c of p.courses) {
        map[c.course_code] = c
      }
    }
    allCourses.value = map
  } catch (err) {
    console.error('Failed to load majors.json:', err)
  } finally {
    loading.value = false
  }
}

export function programsUsingCourse(courseCode) {
  const result = []
  for (const p of programs.value) {
    for (const req of Object.values(p.requirements)) {
      if (req.course_numbers && req.course_numbers.includes(courseCode)) {
        result.push({ program: p, requirement: req })
        break
      }
    }
  }
  return result
}

export const filteredPrograms = computed(() => {
  let list = programs.value
  if (filterType.value !== 'all') {
    list = list.filter(p => p.type.includes(filterType.value))
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.course_prefix && p.course_prefix.toLowerCase().includes(q))
    )
  }
  return list
})
