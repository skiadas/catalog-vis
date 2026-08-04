import { programs, allCourses, parsedRequirements } from '../lib/store.js'
import { route, goToCourse, goHome } from '../lib/router.js'

const { computed } = Vue

export default {
  name: 'ProgramDetail',
  setup() {
    const currentProgram = computed(() => {
      return programs.value.find((p) => p.id === route.value.params.id) || null
    })
    const currentParsed = computed(() => {
      return parsedRequirements.value[route.value.params.id] || null
    })
    return { currentProgram, currentParsed, allCourses, goToCourse, goHome }
  },
  template: `
    <div v-if="currentProgram">
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

      <div v-if="currentParsed && currentParsed.length">
        <div class="section-title">Requirements</div>
        <div
          class="req-block"
          v-for="(req, ri) in currentParsed"
          :key="ri"
        >
          <h4>{{ req.label }}</h4>
          <RequirementSection
            v-for="(section, si) in req.sections"
            :key="si"
            :section="section"
          />
        </div>
      </div>

      <div v-else-if="Object.keys(currentProgram.requirements).length">
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
  `,
}
