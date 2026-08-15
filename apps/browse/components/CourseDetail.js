import { courseByCode, programsUsingCourse } from '@major-vis/catalog-client'
import { route, goToCourse, goToProgram, goHome } from '../router.js'

const { computed } = Vue

export default {
  name: 'CourseDetail',
  setup() {
    const currentCourse = computed(() => courseByCode(route.value.params.code))
    const usage = computed(() => {
      if (!currentCourse.value) return []
      return programsUsingCourse(currentCourse.value.course_code)
    })
    return { currentCourse, usage, courseByCode, goToCourse, goToProgram, goHome }
  },
  template: `
    <div v-if="currentCourse">
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
                v-if="courseByCode(pr.trim())"
              >{{ pr.trim() }}</span>
              <span class="course-chip" v-else style="cursor:default;">{{ pr }}</span>
            </template>
          </div>
        </div>

        <div class="programs-using" v-if="usage.length">
          <h4>Used in these programs</h4>
          <ul>
            <li v-for="pu in usage" :key="pu.program.id">
              <a @click="goToProgram(pu.program.id)">{{ pu.program.name }}</a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  `,
}
