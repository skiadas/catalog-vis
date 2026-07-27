const { createApp, ref, computed, onMounted, watch } = Vue

createApp({
  setup() {
    const programs = ref([])
    const allCourses = ref({})
    const loading = ref(true)
    const route = ref({ view: 'programs', params: {} })
    const searchQuery = ref('')
    const filterType = ref('all')

    async function loadData() {
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

    function parseHash() {
      const hash = window.location.hash.slice(1) || '/'
      const parts = hash.split('/').filter(Boolean)
      if (parts[0] === 'program' && parts[1]) {
        return { view: 'program-detail', params: { id: parts[1] } }
      }
      if (parts[0] === 'course' && parts[1]) {
        return { view: 'course-detail', params: { code: decodeURIComponent(parts[1]) } }
      }
      return { view: 'programs', params: {} }
    }

    function navigate(view, params = {}) {
      let hash = ''
      if (view === 'programs') hash = '#/'
      else if (view === 'program-detail') hash = '#/program/' + params.id
      else if (view === 'course-detail') hash = '#/course/' + encodeURIComponent(params.code)
      window.location.hash = hash
    }

    function handleHashChange() {
      route.value = parseHash()
    }

    const filteredPrograms = computed(() => {
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

    const currentProgram = computed(() => {
      if (route.value.view !== 'program-detail') return null
      return programs.value.find(p => p.id === route.value.params.id) || null
    })

    const currentCourse = computed(() => {
      if (route.value.view !== 'course-detail') return null
      return allCourses.value[route.value.params.code] || null
    })

    function programsUsingCourse(courseCode) {
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

    function parseCourseChip(text) {
      if (!text) return []
      const parts = text.split(/\s+or\s+/i)
      return parts.map(p => p.trim()).filter(Boolean)
    }

    function goToCourse(code) {
      if (code && allCourses.value[code]) {
        navigate('course-detail', { code })
      }
    }

    function goToProgram(id) {
      navigate('program-detail', { id })
    }

    function goHome() {
      navigate('programs')
    }

    onMounted(() => {
      loadData()
      handleHashChange()
      window.addEventListener('hashchange', handleHashChange)
    })

    return {
      programs, allCourses, loading, route, searchQuery, filterType,
      filteredPrograms, currentProgram, currentCourse,
      navigate, goToCourse, goToProgram, goHome,
      programsUsingCourse, parseCourseChip
    }
  },

  template: `
    <div v-if="loading" class="loading">Loading catalog data...</div>

    <template v-if="!loading">
      <!-- Programs List View -->
      <div v-if="route.view === 'programs'">
        <div class="header">
          <h1 @click="goHome">Hanover College</h1>
          <div class="header-sub">Academic Catalog 2025-2026 — All Programs</div>
          <div class="controls">
            <input
              class="search-input"
              type="text"
              placeholder="Search programs..."
              v-model="searchQuery"
            >
            <div class="filter-group">
              <button
                class="filter-btn"
                :class="{ active: filterType === 'all' }"
                @click="filterType = 'all'"
              >All</button>
              <button
                class="filter-btn"
                :class="{ active: filterType === 'major' }"
                @click="filterType = 'major'"
              >Majors</button>
              <button
                class="filter-btn"
                :class="{ active: filterType === 'minor' }"
                @click="filterType = 'minor'"
              >Minors</button>
            </div>
          </div>
        </div>

        <div class="results-count" v-if="filteredPrograms.length !== programs.length">
          Showing {{ filteredPrograms.length }} of {{ programs.length }} programs
        </div>

        <div class="program-grid">
          <div
            class="program-card"
            v-for="p in filteredPrograms"
            :key="p.id"
            @click="goToProgram(p.id)"
          >
            <h3>{{ p.name }}</h3>
            <div class="meta">
              <span class="tag major" v-if="p.type.includes('major')">Major</span>
              <span class="tag minor" v-if="p.type.includes('minor')">Minor</span>
              <span class="tag program" v-if="!p.type.includes('major') && !p.type.includes('minor')">Program</span>
            </div>
            <div class="course-count">{{ p.course_count }} courses</div>
          </div>
        </div>

        <div class="empty-state" v-if="filteredPrograms.length === 0">
          <p>No programs match your search.</p>
        </div>
      </div>

      <!-- Program Detail View -->
      <div v-if="route.view === 'program-detail' && currentProgram">
        <button class="back-btn" @click="goHome">← All Programs</button>

        <div class="detail-header">
          <div class="types">
            <span class="tag major" v-if="currentProgram.type.includes('major')">Major</span>
            <span class="tag minor" v-if="currentProgram.type.includes('minor')">Minor</span>
          </div>
          <h2>{{ currentProgram.name }}</h2>
          <div class="faculty" v-if="currentProgram.faculty && currentProgram.faculty.length">
            Faculty: {{ currentProgram.faculty.join(', ') }}
          </div>
        </div>

        <p class="detail-description" v-if="currentProgram.description">
          {{ currentProgram.description }}
        </p>

        <div v-if="Object.keys(currentProgram.requirements).length">
          <div class="section-title">Requirements</div>

          <div
            class="req-block"
            v-for="(req, key) in currentProgram.requirements"
            :key="key"
          >
            <h4>{{ req.label }}</h4>
            <div class="req-total" v-if="req.total_courses">
              {{ req.total_courses }} total course{{ req.total_courses !== 1 ? 's' : '' }}
            </div>
            <div class="req-courses" v-if="req.course_numbers && req.course_numbers.length">
              <template v-for="cn in req.course_numbers" :key="cn">
                <span
                  class="course-chip"
                  @click="goToCourse(cn)"
                  :title="allCourses[cn] ? allCourses[cn].course_name : ''"
                >
                  {{ cn }}
                </span>
              </template>
            </div>
            <div class="req-original" v-if="req.text">
              {{ req.text }}
            </div>
          </div>
        </div>

        <div style="margin-top: 32px;">
          <div class="section-title">Courses ({{ currentProgram.course_count }})</div>
          <table class="courses-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in currentProgram.courses" :key="c.course_code">
                <td>
                  <span class="course-code-cell" @click="goToCourse(c.course_code)">
                    {{ c.course_code }}
                  </span>
                </td>
                <td>{{ c.course_name }}</td>
                <td>
                  <span>{{ c.description }}</span>
                  <div class="course-prereq" v-if="c.prerequisites && c.prerequisites.length">
                    <span class="course-prereq-label">Prereq:</span>
                    <template v-for="(pr, pi) in c.prerequisites" :key="pi">
                      <span @click="goToCourse(pr.trim())" v-if="allCourses[pr.trim()]">{{ pr.trim() }}</span>
                      <span v-else>{{ pr }}</span>
                      <template v-if="pi < c.prerequisites.length - 1">, </template>
                    </template>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Course Detail View -->
      <div v-if="route.view === 'course-detail' && currentCourse">
        <button class="back-btn" @click="goHome">← All Programs</button>

        <div class="course-detail-card">
          <h2>{{ currentCourse.course_code }}</h2>
          <div style="font-size:18px; font-weight:500; margin-bottom:4px;">
            {{ currentCourse.course_name }}
          </div>
          <div class="course-meta">
            Credits: {{ currentCourse.credit_hours || '1' }}
            <span v-if="currentCourse.program"> · {{ currentCourse.program }}</span>
          </div>

          <div class="course-desc" v-if="currentCourse.description">
            {{ currentCourse.description }}
          </div>

          <div class="prereq-section" v-if="currentCourse.prerequisites && currentCourse.prerequisites.length">
            <h4>Prerequisites</h4>
            <div class="req-courses">
              <template v-for="pr in currentCourse.prerequisites" :key="pr">
                <span
                  class="course-chip"
                  @click="goToCourse(pr.trim())"
                  v-if="allCourses[pr.trim()]"
                >{{ pr.trim() }}</span>
                <span class="course-chip" v-else style="cursor:default;">{{ pr }}</span>
              </template>
            </div>
          </div>

          <div class="programs-using" v-if="programsUsingCourse(currentCourse.course_code).length">
            <h4>Used in these programs</h4>
            <ul>
              <li v-for="pu in programsUsingCourse(currentCourse.course_code)" :key="pu.program.id">
                <a @click="goToProgram(pu.program.id)">{{ pu.program.name }}</a>
                — {{ pu.requirement.label }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </template>
  `
}).mount('#app')
