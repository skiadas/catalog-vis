import { allCourses, takenSet, toggleTaken } from '../lib/store.js'
import { evaluateProgram, audit, gapGroups } from '../lib/planner.js'

const { computed } = Vue

export default {
  name: 'TrackAudit',
  emits: ['remove'],
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
      const groups = []
      for (const s of (requirement && requirement.sections) || []) {
        for (const it of s.items || []) {
          groups.push(...gapGroups(it, takenSet.value, allCourses.value))
        }
      }
      return groups
    })

    const statusLabel = {
      satisfied: 'Met',
      partial: 'Partial',
      unsatisfied: 'Needs work',
      unknown: 'Not structured',
    }

    return { report, gaps, statusLabel, allCourses, toggleTaken }
  },
  template: `
    <div class="planner-req">
      <div class="planner-req-top">
        <span class="planner-status" :class="report.status">{{ statusLabel[report.status] || report.status }}</span>
        <span class="planner-req-label">{{ label }}</span>
        <span class="planner-req-count">{{ report.satisfied }} / {{ report.total }}</span>
        <button class="track-remove-btn" @click="$emit('remove')" title="Remove this track">✕</button>
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
        <div class="planner-gap-group" v-for="(g, gi) in gaps" :key="gi">
          <span class="planner-gap-label" v-if="g.label">{{ g.label }}:</span>
          <span
            v-for="code in g.codes"
            :key="code"
            class="course-chip mini"
            @click="toggleTaken(code)"
            :title="allCourses[code] ? allCourses[code].course_name : ''"
            :class="{ taken: takenSet.has(code) }"
          >{{ code }}</span>
          <span class="planner-gap-note" v-if="g.note && !g.codes">{{ g.note }}</span>
        </div>
      </div>
    </div>
  `,
}
