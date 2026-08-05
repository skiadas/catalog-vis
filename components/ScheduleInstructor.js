import { route } from '../lib/router.js'
import { schedule } from '../lib/store.js'
import { instructorConflicts, compareInstructors } from '../lib/schedule.js'
import { goScheduleCourse, goScheduleSlot, goScheduleInstructor } from '../lib/router.js'
import WeeklyCalendar from './WeeklyCalendar.js'

const { computed } = Vue

export default {
  name: 'ScheduleInstructor',
  components: { WeeklyCalendar },
  setup() {
    const instructors = computed(() =>
      schedule.value ? Object.keys(schedule.value.byInstructor).sort(compareInstructors) : [],
    )
    const name = computed(() => route.value.params.instructor)
    const items = computed(
      () => (schedule.value && name.value ? schedule.value.byInstructor[name.value] : []) || [],
    )
    const conflicts = computed(() => {
      if (!schedule.value) return []
      return instructorConflicts(schedule.value).filter((c) => c.instructor === name.value)
    })
    const itemStyle = (it) => ({
      top: it.start - 480 + 'px',
      height: it.end - it.start + 'px',
    })
    const itemsInDay = (day) =>
      items.value.filter((it) => it.days.includes(day)).sort((a, b) => a.start - b.start)
    const dayItems = (day) =>
      itemsInDay(day).map((it) => ({
        key: it.code + it.o.section + it.o.time,
        it,
        style: itemStyle(it),
      }))
    return {
      instructors,
      name,
      items,
      conflicts,
      dayItems,
      goScheduleCourse,
      goScheduleSlot,
      goScheduleInstructor,
    }
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
          <WeeklyCalendar>
            <template #daycol="{ day }">
              <div
                v-for="b in dayItems(day)"
                :key="b.key"
                class="cal-block teach"
                :style="b.style"
                @click="goScheduleCourse(b.it.code)"
              >
                <div class="cal-block-count">{{ b.it.code }}{{ b.it.o.section }}</div>
              </div>
            </template>
          </WeeklyCalendar>
        </div>
      </div>
    </div>
  `,
}
