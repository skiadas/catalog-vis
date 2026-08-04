import { daySlotBlocks, blockStyle, formatTime, buildFilter, briefInstructor } from '../lib/schedule.js'
import { schedule, selectedDepartments, selectedInstructors, filterMode } from '../lib/store.js'
import { goScheduleSlot, goScheduleDay, goScheduleCourse } from '../lib/router.js'
import WeeklyCalendar from './WeeklyCalendar.js'

const { computed } = Vue

export default {
  name: 'ScheduleGrid',
  components: { WeeklyCalendar },
  setup() {
    const slotTitle = (slot) => slot.items.map((it) => it.code).join(', ')

    const filter = computed(() =>
      buildFilter(filterMode.value, selectedDepartments.value, selectedInstructors.value),
    )

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

    return {
      formatTime,
      schedule,
      blocksInDay,
      filter,
      briefInstructor,
      goScheduleSlot,
      goScheduleDay,
      goScheduleCourse,
    }
  },
  template: `
    <WeeklyCalendar :on-day-click="goScheduleDay">
      <template #daycol="{ day }">
        <div
          v-for="b in blocksInDay(day)"
          :key="b.key"
          class="cal-block"
          :class="{ filtered: b.active }"
          :title="b.title"
          :style="b.style"
          @click="goScheduleSlot(day, b.slot.time)"
        >
          <template v-if="filter.active">
            <div class="cal-block-time">{{ formatTime(b.slot.time) }}</div>
            <div class="cal-block-depts">
              <span
                v-for="it in b.slot.items"
                :key="it.code + it.o.section"
                class="filter-offering"
                :style="{ backgroundColor: filter.color(it) }"
                @click.stop="goScheduleCourse(it.code)"
              >{{ it.code }}{{ it.o.section }}<span class="do-inst">{{ briefInstructor(it.o.instructor) }}</span></span>
            </div>
          </template>
          <template v-else>
            <div class="cal-block-count">{{ b.slot.items.length }} <span class="cal-block-label">course{{ b.slot.items.length !== 1 ? 's' : '' }}</span></div>
            <div class="cal-block-time">{{ formatTime(b.slot.time) }}</div>
          </template>
        </div>
      </template>
    </WeeklyCalendar>
  `,
}
