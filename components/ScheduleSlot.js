import { route } from '../lib/router.js'
import {
  WEEKDAYS,
  WEEKDAY_NAMES,
  formatTime,
  slotKey,
  buildVisual,
  colorForSchedule,
  daySlotTimes,
} from '../lib/schedule.js'
import { selectedDepartments, selectedInstructors, filterMode } from '../lib/store.js'
import {
  schedule,
  selectedScheduleIds,
  colorSchedules,
  editingScheduleId,
  openCourseEdit,
} from '../lib/schedules.js'
import { goScheduleCourse, goScheduleDay, goScheduleSlot } from '../lib/router.js'
import CoursePill from './CoursePill.js'

const { computed } = Vue

export default {
  name: 'ScheduleSlot',
  components: { CoursePill },
  setup() {
    const day = computed(() => route.value.params.day)
    const time = computed(() => route.value.params.time)

    // In edit mode the filter is overridden (like the grid) so the edited
    // schedule's courses are all visible, individually colored, and editable.
    const filter = computed(() => {
      if (editingScheduleId.value) {
        return { active: true, matches: () => true, color: (it) => colorForSchedule(it.sid) }
      }
      return buildVisual(
        filterMode.value,
        selectedDepartments.value,
        selectedInstructors.value,
        selectedScheduleIds.value,
        colorSchedules.value,
      )
    })

    const items = computed(() => {
      if (!schedule.value) return []
      let list = schedule.value.bySlot[slotKey(day.value, time.value)] || []
      if (filter.value.active) {
        list = list.filter((it) => filter.value.matches(it))
      }
      return list
    })
    const times = computed(() => daySlotTimes(day.value))
    const timeIndex = computed(() => times.value.indexOf(time.value))
    const dayIndex = computed(() => WEEKDAYS.indexOf(day.value))
    const prevDay = () => {
      const d = WEEKDAYS[(dayIndex.value + WEEKDAYS.length - 1) % WEEKDAYS.length]
      goScheduleSlot(d, daySlotTimes(d)[0])
    }
    const nextDay = () => {
      const d = WEEKDAYS[(dayIndex.value + 1) % WEEKDAYS.length]
      goScheduleSlot(d, daySlotTimes(d)[0])
    }
    const prevSlot = () =>
      times.value.length
        ? goScheduleSlot(
            day.value,
            times.value[(timeIndex.value + times.value.length - 1) % times.value.length],
          )
        : null
    const nextSlot = () =>
      times.value.length
        ? goScheduleSlot(day.value, times.value[(timeIndex.value + 1) % times.value.length])
        : null
    const isEditable = (it) => editingScheduleId.value != null && it.sid === editingScheduleId.value
    return {
      day,
      time,
      items,
      times,
      timeIndex,
      prevDay,
      nextDay,
      prevSlot,
      nextSlot,
      filter,
      WEEKDAY_NAMES,
      formatTime,
      goScheduleCourse,
      goScheduleDay,
      isEditable,
      openCourseEdit,
    }
  },
  template: `
    <div>
      <button class="back-btn" @click="goScheduleDay(day)">← {{ WEEKDAY_NAMES[day] }}</button>
      <div class="detail-header nav-header">
        <button class="nav-arrow nav-day" title="Previous day" @click="prevDay">⇤</button>
        <button class="nav-arrow" title="Previous slot" @click="prevSlot">←</button>
        <h2>{{ WEEKDAY_NAMES[day] }} · {{ formatTime(time) }}</h2>
        <button class="nav-arrow" title="Next slot" @click="nextSlot">→</button>
        <button class="nav-arrow nav-day" title="Next day" @click="nextDay">⇥</button>
      </div>

      <div class="section-title">Offerings ({{ items.length }})</div>
      <div v-if="!items.length" class="empty-state"><p>No offerings in this slot.</p></div>
      <div class="slot-pills" v-else>
        <CoursePill
          v-for="it in items"
          :key="it.code + it.o.section"
          :item="it"
          :filter-active="filter.active"
          :color="filter.color(it)"
          :editable="isEditable(it)"
          @edit="openCourseEdit(it)"
        />
      </div>
    </div>
  `,
}
