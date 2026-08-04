import { route } from '../lib/router.js'
import { schedule } from '../lib/store.js'
import { WEEKDAYS, WEEKDAY_NAMES, hourMarks, instructorConflicts } from '../lib/schedule.js'
import { goScheduleCourse, goScheduleSlot, goScheduleInstructor } from '../lib/router.js'

const { computed } = Vue

export default {
  name: 'ScheduleInstructor',
  setup() {
    const instructors = computed(() => (schedule.value ? Object.keys(schedule.value.byInstructor).sort() : []))
    const name = computed(() => route.value.params.instructor)
    const items = computed(() => (schedule.value && name.value ? schedule.value.byInstructor[name.value] : []) || [])
    const conflicts = computed(() => {
      if (!schedule.value) return []
      return instructorConflicts(schedule.value).filter(c => c.instructor === name.value)
    })
    const itemStyle = (it) => ({
      top: (it.start - 480) + 'px',
      height: (it.end - it.start) + 'px'
    })
    const itemsInDay = (day) => items.value.filter(it => it.days.includes(day)).sort((a, b) => a.start - b.start)
    const hours = hourMarks()
    return { instructors, name, items, conflicts, WEEKDAYS, WEEKDAY_NAMES, hours, itemStyle, itemsInDay,
      goScheduleCourse, goScheduleSlot, goScheduleInstructor }
  },
  template: `
    <div>
      <div class="course-picker" v-if="instructors.length">
        <label for="schedule-instructor-select">Instructor:</label>
        <select
          id="schedule-instructor-select"
          class="search-input" style="max-width:220px; flex:0 0 auto;"
          :value="name"
          @change="goScheduleInstructor($event.target.value)"
        >
          <option v-for="i in instructors" :key="i" :value="i">{{ i }}</option>
        </select>
      </div>

      <div v-if="!name" class="empty-state"><p>Select an instructor to view their timetable.</p></div>
      <div v-else>
        <div class="detail-header">
          <h2>{{ name }}</h2>
          <div class="faculty">{{ items.length }} offering{{ items.length !== 1 ? 's' : '' }}</div>
        </div>

        <div class="section-title" :class="{ alert: conflicts.length }">
          Conflicts
          <span v-if="conflicts.length" class="conflict-badge">{{ conflicts.length }}</span>
        </div>
        <div v-if="!conflicts.length" class="results-count">No double-bookings detected.</div>
        <div v-for="c in conflicts" :key="c.a.code + c.a.o.time + c.b.code + c.b.o.time" class="conflict-alert">
          <strong>{{ name }}</strong> is double-booked:
          {{ c.a.code }}({{ c.a.o.section }}) {{ c.a.o.days }} {{ c.a.o.time }}
          overlaps {{ c.b.code }}({{ c.b.o.section }}) {{ c.b.o.days }} {{ c.b.o.time }}.
        </div>

        <div style="margin-top:20px;">
          <div class="section-title">Weekly timetable</div>
          <div class="calendar-scroll">
            <div class="calendar">
              <div class="cal-row cal-header">
                <div class="cal-time-head"></div>
                <div class="cal-dayhead" v-for="d in WEEKDAYS" :key="d">
                  {{ d }}<span class="day-name">{{ WEEKDAY_NAMES[d] }}</span>
                </div>
              </div>
              <div class="cal-row cal-body">
                <div class="cal-ruler">
                  <div v-for="h in hours" :key="h.min" class="cal-hour"
                    :style="{ top: (h.min - 480) + 'px', height: '60px' }">{{ h.label }}</div>
                </div>
                <div class="cal-daycol" v-for="d in WEEKDAYS" :key="d">
                  <div v-for="g in hours" :key="g.min" class="cal-guide"
                    :style="{ top: (g.min - 480) + 'px' }"></div>
                  <div
                    v-for="it in itemsInDay(d)"
                    :key="it.code + it.o.section + it.o.time"
                    class="cal-block teach"
                    :style="itemStyle(it)"
                    @click="goScheduleCourse(it.code)"
                  >
                    <div class="cal-block-count">{{ it.code }}{{ it.o.section }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
}