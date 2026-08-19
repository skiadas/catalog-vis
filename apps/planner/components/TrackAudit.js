import { takenSet, placeCourse, removePlanCourse } from '../src/plannerStore.js'
import { allCourses, courseName } from '@major-vis/catalog-client'
import {
  evaluateProgram,
  audit,
  gapGroups,
  assignRequirement,
  describeConstraints,
} from '@major-vis/degree-audit'

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
    // The fully evaluated requirement (per-section matched courses, statuses).
    const evaluated = computed(() => {
      const ev = evaluateProgram(props.parsed || [], takenSet.value, allCourses.value)
      return ev[0] || { label: '', sections: [] }
    })

    const report = computed(
      () =>
        audit([evaluated.value]).requirements[0] || {
          status: 'unknown',
          sections: [],
          satisfied: 0,
          total: 0,
        },
    )

    // Per-section course-level progress: how many courses of the section's
    // requirement are currently counted (`done`/`total`), the courses that count
    // (`counted`), the placed courses in the bucket (`codes`), and the placed
    // courses that can't count under the current constraints (`extra`, rendered
    // as distinctly incompatible chips). A section is never hidden while any of
    // its bucket courses are placed — that's how a placed-but-unqualified course
    // stays visible and removable from the requirements page.
    const sections = computed(() => {
      const rec = report.value.sections || []
      const parsedSections = ((props.parsed || [])[0] || {}).sections || []
      return (evaluated.value.sections || []).map((s, si) => {
        const items = s.items || []
        const counted = []
        const placed = []
        let total = 0
        const parsedItems = (parsedSections[si] || {}).items || []
        const electivesConstraints = parsedItems
          .filter((i) => i.type === 'electives')
          .flatMap((i) => i.constraints || [])
        const reason = describeConstraints(
          electivesConstraints.filter((c) => c.type !== 'from'),
          true,
        )
        for (let ii = 0; ii < items.length; ii++) {
          const it = items[ii]
          total += Number.isFinite(it.min) ? it.min : 0
          for (const c of it.matched || []) if (!counted.includes(c)) counted.push(c)
          const pool = it.type === 'electives' ? it.pool || [] : it.matched || []
          for (const c of pool) if (!placed.includes(c)) placed.push(c)
        }
        const extra = placed.filter((c) => !counted.includes(c))
        const codes = [...counted, ...extra]
        const done = counted.length
        // Course-level status: any placed course in the bucket counts as progress
        // even when nothing is counted yet, so a started-but-incompatible mix
        // reads as "partial" rather than vanishing the whole section.
        const status =
          codes.length === 0
            ? rec[si] || 'unsatisfied'
            : done < total
              ? 'partial'
              : rec[si] && rec[si].status === 'satisfied'
                ? 'satisfied'
                : rec[si] || 'unsatisfied'
        return { heading: s.heading, status, done, total, codes, counted, extra, reason }
      })
    })

    const gaps = computed(() => {
      const requirement = (props.parsed || [])[0]
      const assignment = assignRequirement(requirement, takenSet.value, allCourses.value)
      const independent = requirement && requirement.independentSections === true
      const totalUsed = new Set(assignment.flatMap((a) => [...a.used]))
      const groups = []
      for (const a of assignment) {
        // Core-curriculum sections are independent: a course may satisfy several
        // areas at once (e.g. MAT 121 counts for both QL and SM), so a course
        // claimed by another core area must not be subtracted from this one.
        const excluded = independent ? new Set() : new Set([...totalUsed].filter((c) => !a.used.has(c)))
        groups.push(...gapGroups(a.item, takenSet.value, allCourses.value, excluded))
      }
      return groups
    })

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
      sections,
      gaps,
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
          v-for="(sec, si) in sections"
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
