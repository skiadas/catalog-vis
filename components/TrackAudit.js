import { allCourses, takenSet, toggleTaken } from '../lib/store.js'
import { evaluateProgram, audit, gapGroups, assignRequirement } from '../lib/planner.js'

const { ref, computed } = Vue

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
      const assignment = assignRequirement(requirement, takenSet.value, allCourses.value)
      const totalUsed = new Set(assignment.flatMap((a) => [...a.used]))
      const groups = []
      for (const a of assignment) {
        const excluded = new Set([...totalUsed].filter((c) => !a.used.has(c)))
        groups.push(...gapGroups(a.item, takenSet.value, allCourses.value, excluded))
      }
      return groups
    })

    // Which expandable (electives) gap groups are currently opened.
    const expanded = ref({})
    function toggleExpand(i) {
      expanded.value = { ...expanded.value, [i]: !expanded.value[i] }
    }

    const statusLabel = {
      satisfied: 'Met',
      partial: 'Partial',
      unsatisfied: 'Needs work',
      unknown: 'Not structured',
    }

    return { report, gaps, statusLabel, allCourses, takenSet, toggleTaken, expanded, toggleExpand }
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
          <template v-if="g.expandable">
            <button class="planner-gap-toggle" @click="toggleExpand(gi)">
              <span class="planner-gap-label">{{ g.label }}</span>
              <span class="planner-gap-count">({{ g.codes.length }} option{{ g.codes.length !== 1 ? 's' : '' }})</span>
              <span class="planner-gap-chevron">{{ expanded[gi] ? '▾' : '▸' }}</span>
            </button>
            <div v-if="expanded[gi]" class="planner-gap-options">
              <span
                v-for="code in g.codes"
                :key="code"
                class="course-chip mini"
                @click="toggleTaken(code)"
                :title="allCourses[code] ? allCourses[code].course_name : ''"
                :class="{ taken: takenSet.has(code) }"
              >{{ code }}</span>
            </div>
          </template>
          <template v-else>
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
          </template>
        </div>
      </div>
    </div>
  `,
}
