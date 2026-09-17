<template>
  <div>
    <div v-if="!code || !sections.length" class="empty-state">
      <p>Select a course from the dropdown above to view its offerings and conflicts.</p>
    </div>
    <div v-else>
      <div class="detail-header">
        <h2>{{ code }}</h2>
        <div class="faculty" v-if="catalog">{{ catalog.course_name }}</div>
      </div>

      <div class="section-title">Offerings ({{ sections.length }})</div>
      <div class="req-block" v-for="s in sections" :key="offeringItemKey(s)">
        <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px">
          <div>
            <strong>{{ s.sectionLabel }}</strong> · {{ s.o.days }} {{ formatTime(s.o.time) }}
          </div>
          <div class="faculty">
            Instructor:
            <template v-for="(n, i) in s.instructors" :key="n"
              ><span v-if="i" class="sep">, </span
              ><button type="button" class="faculty-link" @click="goScheduleInstructor(n)">
                {{ n }}
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
                <button type="button" class="course-code-cell" @click="goScheduleCourse(c)">{{ c }}</button>
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

    <p class="results-count" style="margin-top: 20px">
      {{ scheduleOfferings.length }} total offerings across
      {{ Object.keys(schedule.byCourse).length }} courses.
    </p>
  </div>
</template>

<script>
import { useRoute } from 'vue-router'
import { schedule, scheduleOfferings } from '../src/scheduleStore.js'
import { courseByCode, courseName } from '@major-vis/catalog-client'
import { conflictsForCourse, formatTime, offeringItemKey } from '@major-vis/schedule-core'
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
    const nameFor = courseName
    return {
      code,
      sections,
      conflicts,
      schedule,
      scheduleOfferings,
      catalog,
      nameFor,
      formatTime,
      offeringItemKey,
      goScheduleCourse,
      goScheduleSlot,
      goScheduleInstructor,
    }
  },
}
</script>
