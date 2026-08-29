import { takenSet, placeCourse, removePlanCourse } from '../src/plannerStore.js'
import { allCourses, courseName } from '@major-vis/catalog-client'
import { trackReport } from '@major-vis/degree-audit'

import { ref, computed } from 'vue'

export default {
  name: 'TrackAudit',
  emits: ['remove'],
  props: {
    program: { type: Object, required: true },
    parsed: { type: Array, required: true },
    label: { type: String, default: '' },
  },
  setup(props) {
    // The whole track status — roll-up, per-section course chips, and the
    // still-needed suggestions — is computed in pure degree-audit code
    // (trackReport) so the component is a thin renderer. Keep a stable {} when
    // there's no parsed requirement yet.
    const report = computed(
      () =>
        trackReport((props.parsed || [])[0], takenSet.value, allCourses.value) || {
          status: 'unknown',
          sections: [],
          gaps: [],
          satisfied: 0,
          total: 0,
        },
    )

    // Clicking a suggested course adds it to the unassigned shelf; clicking one
    // already in the plan removes it.
    function togglePlaced(code) {
      if (takenSet.value.has(code)) removePlanCourse(code)
      else placeCourse(code)
    }

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

    return {
      report,
      statusLabel,
      courseName,
      takenSet,
      togglePlaced,
      expanded,
      toggleExpand,
    }
  },
  template: `
    <div class="planner-req">
      <div class="planner-req-top">
        <span class="planner-status" :class="report.status">{{ statusLabel[report.status] || report.status }}</span>
        <span class="planner-req-label">{{ label }}</span>
        <span class="planner-req-count">{{ report.satisfied }} / {{ report.total }}</span>
        <button class="track-remove-btn" @click="$emit('remove')" title="Remove this track">✕</button>
      </div>
      <div class="planner-sections">
        <div
          v-for="(sec, si) in report.sections"
          :key="si"
          class="planner-section"
          :class="sec.status"
          v-show="sec.codes.length || sec.status === 'partial'"
        >
          <div class="planner-section-head">
            <span class="planner-section-title">{{ sec.heading || 'Section' }}</span>
            <span class="planner-section-count" :class="sec.status">{{ sec.done }}/{{ sec.total }}</span>
            <span v-if="sec.status === 'partial'" class="planner-section-more">
              need {{ sec.total - sec.done }} more
            </span>
          </div>
          <div v-if="sec.status === 'partial' && sec.reason" class="planner-section-reason">
            {{ sec.reason }}
          </div>
          <div v-if="sec.codes.length" class="planner-section-courses">
            <span
              v-for="code in sec.counted"
              :key="code"
              class="course-chip mini matched"
              @click="togglePlaced(code)"
              :title="(courseName(code) ? courseName(code) + ' — ' : '') + 'click to remove from plan'"
            >{{ code }}</span>
            <span
              v-for="code in sec.extra"
              :key="code"
              class="course-chip mini incompatible"
              @click="togglePlaced(code)"
              :title="
                (courseName(code) ? courseName(code) + ' — ' : '') +
                'in your plan but does not count toward this yet' +
                (sec.reason ? ' (' + sec.reason + ')' : '') +
                '. Click to remove.'
              "
            >{{ code }} ✕</span>
          </div>
        </div>
      </div>
      <div class="planner-gaps" v-if="report.status !== 'satisfied'">
        <div class="planner-gap-group" v-for="(g, gi) in report.gaps" :key="gi">
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
                @click="togglePlaced(code)"
                :title="courseName(code)"
                :class="{ taken: takenSet.has(code) }"
              >{{ code }}</span>
            </div>
          </template>
          <template v-else-if="g.alternatives">
            <div class="planner-gap-label">{{ g.label }}:</div>
            <div
              v-for="(alt, ai) in g.alternatives"
              :key="ai"
              class="planner-gap-alternative"
            >
              <span class="anyof-option">{{ 'Option ' + (ai + 1) }}</span>
              <template v-for="(slot, si) in alt.slots" :key="si">
                <span v-if="si > 0" class="pair-plus">+</span>
                <span v-if="slot.label" class="planner-gap-slot-label">{{ slot.label }}</span>
                <template v-for="(code, ci) in slot.codes" :key="code">
                  <span
                    class="course-chip mini"
                    @click="togglePlaced(code)"
                    :title="courseName(code)"
                    :class="{ taken: takenSet.has(code) }"
                  >{{ code }}</span>
                  <span v-if="slot.label && ci < slot.codes.length - 1" class="anyof-or">or</span>
                </template>
              </template>
            </div>
          </template>
          <template v-else>
            <span class="planner-gap-label" v-if="g.label">{{ g.label }}:</span>
            <span
              v-for="code in g.codes"
              :key="code"
              class="course-chip mini"
              @click="togglePlaced(code)"
              :title="courseName(code)"
              :class="{ taken: takenSet.has(code) }"
            >{{ code }}</span>
            <span class="planner-gap-note" v-if="g.note && !g.codes">{{ g.note }}</span>
          </template>
        </div>
      </div>
    </div>
  `,
}
