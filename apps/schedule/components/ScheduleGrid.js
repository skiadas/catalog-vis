import {
  daySlotBlocks,
  blockStyle,
  formatTime,
  buildVisual,
  briefInstructor,
  SLOT_BLOCKS,
  toMinutes,
  colorForSchedule,
} from '@major-vis/schedule-core'
import { selectedDepartments, selectedInstructors, filterMode } from '../src/scheduleStore.js'
import {
  schedule,
  selectedScheduleIds,
  colorSchedules,
  editingScheduleId,
  moveOffering,
  openCourseEdit,
} from '../src/scheduleStore.js'
import { goScheduleSlot, goScheduleDay, goScheduleCourse } from '../router.js'
import { useScheduleDrag } from '../scheduleDrag.js'
import WeeklyCalendar from './WeeklyCalendar.js'

const { computed } = Vue

// The day-group a weekday column belongs to: MWF days are M/W/F, TR days are T/R.
function dayGroup(day) {
  return day === 'M' || day === 'W' || day === 'F' ? 'MWF' : 'TR'
}

export default {
  name: 'ScheduleGrid',
  components: { WeeklyCalendar },
  setup() {
    const slotTitle = (slot) => slot.items.map((it) => it.code).join(', ')

    // In edit mode we force the per-course colored view so the edited schedule's
    // courses are individually visible (and draggable). Otherwise fall back to
    // the normal filter / schedule-coloring behavior.
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

    const dayBlocks = (day) => {
      const blocks = daySlotBlocks(day, schedule.value)
      if (!filter.value.active) return blocks
      const out = []
      for (const b of blocks) {
        const items = b.items.filter((it) => filter.value.matches(it))
        if (items.length) out.push({ ...b, items })
      }
      return out
    }

    const blocksInDay = (day) =>
      dayBlocks(day).map((slot) => ({
        key: slot.time,
        slot,
        style: blockStyle(slot),
        title: slotTitle(slot),
        active: filter.value.active,
      }))

    // A course belonging to the schedule being edited is draggable.
    const editingId = editingScheduleId
    const { dragOver, isEditable, onDragStart, zoneOver, zoneLeave, zoneDrop } = useScheduleDrag(
      editingScheduleId,
      moveOffering,
    )

    // The 10 standard time slots per weekday are the drop targets. Bands already
    // occupied by a block get their drop handling on the block itself; the rest
    // become empty drop zones.
    const standardTimes = (day) => {
      const times = []
      for (const block of SLOT_BLOCKS) {
        if (!block.label.includes(day)) continue
        for (const slot of block.slots) times.push(slot.time)
      }
      return times
    }
    const dropZones = (day) => {
      const occupied = new Set(dayBlocks(day).map((b) => b.time))
      return standardTimes(day)
        .filter((time) => !occupied.has(time))
        .map((time) => {
          const [startStr, endStr] = time.split('-')
          const band = { start: toMinutes(startStr), end: toMinutes(endStr) }
          return {
            key: dayGroup(day) + '|' + time,
            day,
            days: dayGroup(day),
            time,
            style: blockStyle(band),
          }
        })
    }

    return {
      formatTime,
      schedule,
      blocksInDay,
      filter,
      briefInstructor,
      goScheduleSlot,
      goScheduleDay,
      goScheduleCourse,
      dropZones,
      isEditable,
      editingId,
      dragOver,
      dayGroup,
      onDragStart,
      zoneOver,
      zoneLeave,
      zoneDrop,
      openCourseEdit,
    }
  },
  template: `
    <div>
      <WeeklyCalendar :on-day-click="goScheduleDay" :striped="filter.active">
        <template #daycol="{ day }">
          <div
            v-for="z in dropZones(day)"
            :key="z.key"
            class="cal-block cal-dropzone"
            :class="{ over: dragOver === z.key }"
            :style="z.style"
            @dragover="zoneOver($event, z)"
            @dragleave="zoneLeave"
            @drop="zoneDrop($event, z)"
          ></div>
          <div
            v-for="b in blocksInDay(day)"
            :key="b.key"
            class="cal-block"
            :class="{ filtered: b.active, over: dragOver === dayGroup(day) + '|' + b.slot.time }"
            :title="b.title"
            :style="b.style"
            @click="goScheduleSlot(day, b.slot.time)"
            @dragover="zoneOver($event, { key: dayGroup(day) + '|' + b.slot.time, day, days: dayGroup(day), time: b.slot.time })"
            @dragleave="zoneLeave"
            @drop="zoneDrop($event, { day, days: dayGroup(day), time: b.slot.time })"
          >
            <template v-if="filter.active">
              <div class="cal-block-time">{{ formatTime(b.slot.time) }}</div>
              <div class="cal-block-depts">
                <span
                  v-for="it in b.slot.items"
                  :key="it.code + it.o.section"
                  class="filter-offering"
                  :class="{ draggable: isEditable(it) }"
                  :style="{ backgroundColor: filter.color(it) }"
                  :draggable="isEditable(it)"
                  @click.stop="goScheduleCourse(it.code)"
                  @dragstart="onDragStart($event, it, day)"
                  :title="isEditable(it) ? 'Drag to move' : ''"
                >
                  <span class="filter-offering-main">{{ it.code }}{{ it.o.section }}<span class="do-inst">{{ briefInstructor(it.o.instructor) }}</span></span>
                  <button
                    v-if="isEditable(it)"
                    class="filter-offering-edit"
                    :title="'Edit ' + it.code"
                    aria-label="Edit course"
                    @click.stop="openCourseEdit(it)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                  </button>
                </span>
              </div>
            </template>
            <template v-else>
              <div class="cal-block-count">{{ b.slot.items.length }} <span class="cal-block-label">course{{ b.slot.items.length !== 1 ? 's' : '' }}</span></div>
              <div class="cal-block-time">{{ formatTime(b.slot.time) }}</div>
            </template>
          </div>
        </template>
      </WeeklyCalendar>
    </div>
  `,
}
