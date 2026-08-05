import { allCourses, takenSet, toggleTaken, resetTaken } from '../lib/store.js'
import { goToCourse } from '../lib/router.js'
import { evaluateProgram, audit, planGaps } from '../lib/planner.js'

const { computed, ref } = Vue

export default {
  name: 'PlannerPanel',
  props: {
    program: { type: Object, required: true },
    parsed: { type: Array, default: () => null },
  },
  setup(props) {
    const search = ref('')

    const catalog = computed(() => allCourses.value)

    const evaluated = computed(() => evaluateProgram(props.parsed || [], takenSet.value, catalog.value))
    const report = computed(() => audit(evaluated.value))

    const matchingCourses = computed(() => {
      const q = search.value.trim().toLowerCase()
      const pool = q ? Object.values(allCourses.value) : props.program.courses || []
      const source = q
        ? pool.filter(
            (c) =>
              c.course_code.toLowerCase().includes(q) ||
              (c.course_name && c.course_name.toLowerCase().includes(q)),
          )
        : [...pool].sort((a, b) => a.course_code.localeCompare(b.course_code))
      return source.slice(0, 200)
    })

    function requirementGaps(rawReq) {
      const courses = []
      let aggregate = false
      let unknown = false
      for (const s of rawReq.sections || []) {
        for (const it of s.items || []) {
          const gaps = planGaps(it, takenSet.value, catalog.value)
          if (gaps.aggregate) aggregate = true
          if (gaps.unknown) unknown = true
          courses.push(...gaps.courses)
        }
      }
      return { courses: [...new Set(courses)], aggregate, unknown }
    }

    const statusLabel = {
      satisfied: 'Met',
      partial: 'Partial',
      unsatisfied: 'Needs work',
      unknown: 'Not structured',
    }

    return {
      search,
      report,
      matchingCourses,
      requirementGaps,
      statusLabel,
      allCourses,
      takenSet,
      toggleTaken,
      resetTaken,
      goToCourse,
    }
  },
  template: `
    <div class="planner-panel">
      <div class="planner-header">
        <div class="planner-title">Requirements Planner</div>
        <div class="planner-sub">
          <span class="req-status overall" :class="report.status === 'satisfied' ? 'satisfied' : report.status === 'partial' ? 'partial' : 'unsatisfied'">
            {{ report.satisfied }} of {{ report.total }} requirements met
          </span>
          <span class="planner-taken-count">{{ takenSet.size }} course{{ takenSet.size !== 1 ? 's' : '' }} marked as taken</span>
          <button class="planner-reset" @click="resetTaken()" v-if="takenSet.size">Reset</button>
        </div>
      </div>

      <div class="planner-requirements">
        <div class="planner-req" v-for="(req, ri) in report.requirements" :key="ri">
          <div class="planner-req-top">
            <span class="planner-status" :class="req.status">{{ statusLabel[req.status] || req.status }}</span>
            <span class="planner-req-label">{{ req.label }}</span>
            <span class="planner-req-count">{{ req.satisfied }} / {{ req.total }}</span>
          </div>
          <div class="planner-req-sections">
            <span
              v-for="(sec, si) in req.sections"
              :key="si"
              class="planner-section-chip"
              :class="sec.status"
              :title="(sec.heading || 'section') + ': ' + sec.satisfied + ' / ' + sec.total"
            >
              {{ sec.satisfied }}/{{ sec.total }}
            </span>
          </div>
          <div class="planner-gaps" v-if="req.status !== 'satisfied'">
            <template v-for="gap in [requirementGaps(parsed[ri])]" :key="'g'">
              <div v-if="gap.unknown" class="planner-gap-note">Includes unstructured requirements.</div>
              <div v-if="gap.aggregate" class="planner-gap-note">
                Needs enough courses in a specific category (level/discipline).
              </div>
              <div v-if="gap.courses.length" class="planner-gap-courses">
                Still need:
                <span
                  v-for="code in gap.courses.slice(0, 12)"
                  :key="code"
                  class="course-chip mini"
                  @click="goToCourse(code)"
                  :title="allCourses[code] ? allCourses[code].course_name : ''"
                >{{ code }}</span>
                <span v-if="gap.courses.length > 12" class="planner-gap-more">+{{ gap.courses.length - 12 }} more</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div class="planner-picker">
        <div class="section-title" style="font-size:15px; border-bottom:none; margin-bottom:8px;">Mark courses as taken</div>
        <input v-model="search" class="planner-search" type="search" placeholder="Search any course code or name…" />
        <div class="planner-pick-list">
          <button
            v-for="c in matchingCourses"
            :key="c.course_code"
            class="planner-pick"
            :class="{ taken: takenSet.has(c.course_code) }"
            @click="toggleTaken(c.course_code)"
            :title="c.course_name"
          >
            <span class="planner-pick-code">{{ c.course_code }}</span>
            <span class="planner-pick-name">{{ c.course_name }}</span>
          </button>
          <div v-if="!matchingCourses.length" class="planner-pick-empty">No matching courses.</div>
        </div>
      </div>
    </div>
  `,
}
