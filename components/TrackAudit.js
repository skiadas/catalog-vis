import { allCourses, takenSet } from '../lib/store.js'
import { goToCourse } from '../lib/router.js'
import { evaluateProgram, audit, planGaps } from '../lib/planner.js'

const { computed } = Vue

export default {
  name: 'TrackAudit',
  props: {
    program: { type: Object, required: true },
    parsed: { type: Array, required: true },
    label: { type: String, default: '' },
  },
  setup(props) {
    const report = computed(() => {
      const ev = evaluateProgram(props.parsed || [], takenSet.value, allCourses.value)
      return audit(ev).requirements[0] || { status: 'unknown', sections: [], satisfied: 0, total: 0 }
    })

    const gaps = computed(() => {
      const requirement = (props.parsed || [])[0]
      const courses = []
      let aggregate = false
      let unknown = false
      for (const s of (requirement && requirement.sections) || []) {
        for (const it of s.items || []) {
          const g = planGaps(it, takenSet.value, allCourses.value)
          if (g.aggregate) aggregate = true
          if (g.unknown) unknown = true
          courses.push(...g.courses)
        }
      }
      return { courses: [...new Set(courses)], aggregate, unknown }
    })

    const statusLabel = {
      satisfied: 'Met',
      partial: 'Partial',
      unsatisfied: 'Needs work',
      unknown: 'Not structured',
    }

    return { report, gaps, statusLabel, allCourses, goToCourse }
  },
  template: `
    <div class="planner-req">
      <div class="planner-req-top">
        <span class="planner-status" :class="report.status">{{ statusLabel[report.status] || report.status }}</span>
        <span class="planner-req-label">{{ label }}</span>
        <span class="planner-req-count">{{ report.satisfied }} / {{ report.total }}</span>
      </div>
      <div class="planner-req-sections">
        <span
          v-for="(sec, si) in report.sections"
          :key="si"
          class="planner-section-chip"
          :class="sec.status"
          :title="(sec.heading || 'section') + ': ' + sec.satisfied + ' / ' + sec.total"
        >
          {{ sec.satisfied }}/{{ sec.total }}
        </span>
      </div>
      <div class="planner-gaps" v-if="report.status !== 'satisfied'">
        <div v-if="gaps.unknown" class="planner-gap-note">Includes unstructured requirements.</div>
        <div v-if="gaps.aggregate" class="planner-gap-note">
          Needs enough courses in a specific category (level/discipline).
        </div>
        <div v-if="gaps.courses.length" class="planner-gap-courses">
          Still need:
          <span
            v-for="code in gaps.courses.slice(0, 12)"
            :key="code"
            class="course-chip mini"
            @click="goToCourse(code)"
            :title="allCourses[code] ? allCourses[code].course_name : ''"
          >{{ code }}</span>
          <span v-if="gaps.courses.length > 12" class="planner-gap-more">+{{ gaps.courses.length - 12 }} more</span>
        </div>
      </div>
    </div>
  `,
}
