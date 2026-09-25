<template>
  <div>
    <div v-if="!code || !sections.length" class="empty-state">
      <p>Select a course from the dropdown above to view its offerings and conflicts.</p>
    </div>
    <div v-else>
      <div class="course-detail-layout">
        <div class="course-detail-main">
          <div class="detail-header">
            <h2>{{ code }}</h2>
            <div class="faculty" v-if="catalog">{{ catalog.course_name }}</div>
          </div>

          <div class="section-title">Offerings ({{ sections.length }})</div>
          <div class="req-block" v-for="s in sections" :key="offeringItemKey(s)">
            <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px">
              <div>
                <div>
                  <strong>{{ s.sectionLabel }}</strong> · {{ s.o.days }} {{ formatTime(s.o.time) }} · Seats:
                  {{ s.o.seats ?? DEFAULT_SEATS }}
                </div>
                <div v-if="offeringTitle(s.o)" class="offering-title">{{ offeringTitle(s.o) }}</div>
              </div>
              <div class="faculty">
                Instructor:
                <template v-for="(n, i) in s.instructors" :key="n"
                  ><span v-if="i" class="sep">, </span
                  ><button type="button" class="faculty-link" @click="goScheduleInstructor(n)">
                    {{ instructorName(n) }}
                  </button></template
                ><span v-if="!s.instructors.length">—</span>
              </div>
            </div>
          </div>

          <div style="margin-top: 24px">
            <div class="section-title">Conflicts ({{ conflicts.length }})</div>
            <div v-if="!conflicts.length" class="empty-state">
              <p>No student-side time conflicts for this course.</p>
            </div>
            <table class="courses-table" v-else>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Conflicting times</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in conflicts" :key="c">
                  <td>
                    <button type="button" class="course-code-cell" @click="goScheduleCourse(c)">
                      {{ c }}
                    </button>
                    <span class="conflict-course-name">{{ nameFor(c) }}</span>
                  </td>
                  <td>
                    <button
                      v-for="sec in schedule.byCourse[c]"
                      :key="sec.o.days + sec.o.time"
                      type="button"
                      class="course-chip mini"
                      @click="goScheduleSlot(sec.days[0], sec.o.time)"
                    >
                      {{ sec.o.days }} {{ sec.o.time }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <aside class="course-detail-aside" aria-labelledby="course-core-reqs-title">
          <div id="course-core-reqs-title" class="section-title">Core requirements</div>
          <p v-if="!coreReqs.length" class="core-req-empty">None.</p>
          <ul v-else class="core-req-list">
            <li v-for="r in coreReqs" :key="r.id" class="core-req-item">
              <span class="core-req-id" :style="{ backgroundColor: colorForCoreReq(r.id) }">{{ r.id }}</span>
              <span class="core-req-label">{{ r.label }}</span>
            </li>
          </ul>

          <div v-if="crossList" class="cross-list-note">
            <div class="section-title">Cross-listed</div>
            <p class="core-req-label">
              Also listed as {{ crossList.others.join(', ') }}.
              <template v-if="crossList.present.length">
                On this schedule: {{ crossList.present.join(', ') }}.
              </template>
              <template v-if="crossList.owner"> Maintained by {{ crossList.owner }}.</template>
            </p>
          </div>
        </aside>
      </div>
    </div>

    <p class="results-count" style="margin-top: 20px">
      {{ scheduleOfferings.length }} total offerings across
      {{ Object.keys(schedule.byCourse).length }} courses.
    </p>
  </div>
</template>

<script>
import { useRoute } from 'vue-router'
import { schedule, scheduleOfferings, instructorName } from '../src/scheduleStore.js'
import {
  courseByCode,
  courseName,
  coreReqLabel,
  coreReqsByCode,
  crossListOf,
} from '@major-vis/catalog-client'
import {
  conflictsForCourse,
  formatTime,
  offeringItemKey,
  colorForCoreReq,
  DEFAULT_SEATS,
} from '@major-vis/schedule-core'
import { goScheduleCourse, goScheduleSlot, goScheduleInstructor } from '../router.js'

import { computed } from 'vue'

export default {
  name: 'ScheduleCourse',
  setup() {
    const route = useRoute()
    const code = computed(() => String(route.params.code || ''))
    const sections = computed(
      () => (schedule.value && code.value ? schedule.value.byCourse[code.value] : []) || [],
    )
    const conflicts = computed(() =>
      schedule.value && code.value ? conflictsForCourse(code.value, schedule.value) : [],
    )
    const catalog = computed(() => courseByCode(code.value))
    // The core-curriculum areas this course satisfies, resolved from the
    // catalog (read-only; the schedule never stores the mapping).
    const coreReqs = computed(() =>
      (coreReqsByCode().get(code.value) || []).map((id) => ({ id, label: coreReqLabel(id) })),
    )
    // Cross-listing: the other catalog codes, and which of them are on this
    // term's schedule (the sibling versions). The owner comes from the row.
    const crossList = computed(() => {
      const others = crossListOf(code.value)
      if (!others.length) return null
      const present = others.filter((c) => (schedule.value.byCourse[c] || []).length > 0)
      const owner = (sections.value[0] && sections.value[0].o.crossListOwner) || null
      return { others, present, owner }
    })
    const nameFor = courseName
    // The offering's own title, shown only when it differs from the catalog
    // name (the header already carries the catalog name for the course).
    const offeringTitle = (o) => {
      const t = String((o && o.title) || '').trim()
      if (!t) return ''
      const cat = catalog.value && catalog.value.course_name
      return t === cat ? '' : t
    }
    return {
      code,
      sections,
      conflicts,
      schedule,
      scheduleOfferings,
      catalog,
      nameFor,
      offeringTitle,
      coreReqs,
      crossList,
      colorForCoreReq,
      instructorName,
      formatTime,
      offeringItemKey,
      DEFAULT_SEATS,
      goScheduleCourse,
      goScheduleSlot,
      goScheduleInstructor,
    }
  },
}
</script>
