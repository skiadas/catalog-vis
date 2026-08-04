import { route } from '../lib/router.js'
import { WEEKDAY_NAMES, formatTime, slotKey, buildFilter } from '../lib/schedule.js'
import { schedule, selectedDepartments, selectedInstructors, filterMode } from '../lib/store.js'
import { goScheduleCourse, goScheduleDay, goScheduleInstructor } from '../lib/router.js'

const { computed } = Vue

export default {
  name: 'ScheduleSlot',
  setup() {
    const day = computed(() => route.value.params.day)
    const time = computed(() => route.value.params.time)
    const filter = computed(() => buildFilter(filterMode.value, selectedDepartments.value, selectedInstructors.value))
    const items = computed(() => {
      if (!schedule.value) return []
      let list = schedule.value.bySlot[slotKey(day.value, time.value)] || []
      if (filter.value.active) {
        list = list.filter(it => filter.value.matches(it))
      }
      return list
    })
    return { day, time, items, filter, WEEKDAY_NAMES, formatTime, goScheduleCourse, goScheduleDay, goScheduleInstructor }
  },
  template: `
    <div>
      <button class="back-btn" @click="goScheduleDay(day)">← {{ WEEKDAY_NAMES[day] }}</button>
      <div class="detail-header">
        <h2>{{ WEEKDAY_NAMES[day] }} · {{ formatTime(time) }}</h2>
      </div>

      <div class="section-title">Offerings ({{ items.length }})</div>
      <div v-if="!items.length" class="empty-state"><p>No offerings in this slot.</p></div>
      <table class="courses-table" v-else>
        <thead>
          <tr><th>Course</th><th>Section</th><th>Instructor</th></tr>
        </thead>
        <tbody>
          <tr v-for="it in items" :key="it.code + it.o.section">
            <td><span :class="filter.active ? 'course-chip dept-colored' : 'course-code-cell'" :style="filter.active ? { backgroundColor: filter.color(it) } : {}" @click="goScheduleCourse(it.code)">{{ it.code }}</span></td>
            <td>{{ it.o.section }}</td>
            <td>
              <span class="course-code-cell" @click="goScheduleInstructor(it.o.instructor)">
                {{ it.o.instructor }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `
}