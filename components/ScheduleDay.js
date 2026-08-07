import { route } from '../lib/router.js'
import {
  WEEKDAYS,
  WEEKDAY_NAMES,
  SLOT_BLOCKS,
  formatTime,
  slotKey,
  buildVisual,
  colorForSchedule,
} from '../lib/schedule.js'
import { selectedDepartments, selectedInstructors, filterMode } from '../lib/store.js'
import {
  schedule,
  selectedScheduleIds,
  colorSchedules,
  editingScheduleId,
  moveOffering,
  openCourseEdit,
} from '../lib/schedules.js'
import { goScheduleSlot, goScheduleCourse, goScheduleDay } from '../lib/router.js'
import { useScheduleDrag } from '../lib/scheduleDrag.js'
import CoursePill from './CoursePill.js'

const { computed } = Vue

export default {
  name: 'ScheduleDay',
  components: { CoursePill },
  setup() {
    const day = computed(() => route.value.params.day)

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

    const dayIndex = computed(() => WEEKDAYS.indexOf(day.value))
    const prevDay = () => goScheduleDay(WEEKDAYS[(dayIndex.value + WEEKDAYS.length - 1) % WEEKDAYS.length])
    const nextDay = () => goScheduleDay(WEEKDAYS[(dayIndex.value + 1) % WEEKDAYS.length])

    // Every standard time band for the day, in order: occupied ones render as
    // offering cards, empty ones as drop targets for edit-mode drags.
    const dayTimes = computed(() => {
      const out = []
      for (const block of SLOT_BLOCKS) {
        if (!block.label.includes(day.value)) continue
        for (const slot of block.slots)
          out.push({ key: slot.time, day: day.value, days: block.label, ...slot })
      }
      return out
    })
    const itemsFor = (time) => {
      let items = schedule.value.bySlot[slotKey(day.value, time)] || []
      if (filter.value.active) items = items.filter((it) => filter.value.matches(it))
      return items
    }
    const hasAny = computed(() => dayTimes.value.some((t) => itemsFor(t.time).length > 0))

    // Drag-and-drop between this day's slots (edit mode only).
    const { dragOver, isEditable, zoneOver, zoneLeave, zoneDrop } = useScheduleDrag(
      editingScheduleId,
      moveOffering,
    )

    return {
      day,
      dayTimes,
      itemsFor,
      hasAny,
      filter,
      prevDay,
      nextDay,
      WEEKDAY_NAMES,
      formatTime,
      goScheduleSlot,
      goScheduleCourse,
      isEditable,
      dragOver,
      zoneOver,
      zoneLeave,
      zoneDrop,
      openCourseEdit,
    }
  },
  template: `
    <div>
      <div class="detail-header nav-header">
        <button class="nav-arrow" @click="prevDay">←</button>
        <h2>{{ WEEKDAY_NAMES[day] }}</h2>
        <button class="nav-arrow" @click="nextDay">→</button>
      </div>
      <p class="results-count" v-if="!hasAny">No classes scheduled this day.</p>

      <div
        v-for="t in dayTimes"
        :key="t.time"
        class="day-slot-card"
        :class="{ 'drag-over': dragOver === t.key }"
        @dragover="zoneOver($event, t)"
        @dragleave="zoneLeave"
        @drop="zoneDrop($event, t)"
      >
        <div class="day-slot-head" @click="goScheduleSlot(day, t.time)">
          <span class="day-slot-time">{{ formatTime(t.time) }}</span>
          <span class="day-slot-count">{{ itemsFor(t.time).length }} offering{{ itemsFor(t.time).length !== 1 ? 's' : '' }}</span>
        </div>
        <div class="day-slot-items" v-if="itemsFor(t.time).length">
          <CoursePill
            v-for="it in itemsFor(t.time)"
            :key="it.code + it.o.section"
            :item="it"
            :filter-active="filter.active"
            :color="filter.color(it)"
            :editable="isEditable(it)"
            :draggable="isEditable(it)"
            :drag-day="day"
            @edit="openCourseEdit(it)"
          />
        </div>
        <div class="day-slot-empty" v-else>No offerings</div>
      </div>
    </div>
  `,
}
