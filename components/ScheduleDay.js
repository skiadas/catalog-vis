import { route } from '../lib/router.js'
import {
  WEEKDAY_NAMES,
  SLOT_BLOCKS,
  formatTime,
  slotKey,
  buildFilter,
  briefInstructor,
} from '../lib/schedule.js'
import { schedule, selectedDepartments, selectedInstructors, filterMode } from '../lib/store.js'
import { goScheduleSlot, goScheduleCourse } from '../lib/router.js'

const { computed } = Vue

export default {
  name: 'ScheduleDay',
  setup() {
    const day = computed(() => route.value.params.day)
    const filter = computed(() =>
      buildFilter(filterMode.value, selectedDepartments.value, selectedInstructors.value),
    )
    const slots = computed(() => {
      const out = []
      for (const block of SLOT_BLOCKS) {
        const days = block.label
        if (!days.includes(day.value)) continue
        for (const slot of block.slots) {
          let items = schedule.value.bySlot[slotKey(day.value, slot.time)] || []
          if (filter.value.active) {
            items = items.filter((it) => filter.value.matches(it))
          }
          if (items.length) {
            out.push({ ...slot, days: block.label, items })
          }
        }
      }
      return out
    })
    return {
      day,
      slots,
      filter,
      WEEKDAY_NAMES,
      formatTime,
      briefInstructor,
      goScheduleSlot,
      goScheduleCourse,
    }
  },
  template: `
    <div>
      <div class="detail-header">
        <h2>{{ WEEKDAY_NAMES[day] }}</h2>
      </div>
      <p class="results-count" v-if="!slots.length">No classes scheduled this day.</p>

      <div class="day-slot-card" v-for="s in slots" :key="s.time">
        <div class="day-slot-head" @click="goScheduleSlot(day, s.time)">
          <span class="day-slot-time">{{ formatTime(s.time) }}</span>
          <span class="day-slot-count">{{ s.items.length }} offering{{ s.items.length !== 1 ? 's' : '' }}</span>
        </div>
        <div class="day-slot-items" v-if="s.items.length">
          <span
            v-for="it in s.items"
            :key="it.code + it.o.section"
            class="course-chip"
            :class="{ 'filter-colored': filter.active }"
            :style="filter.active ? { backgroundColor: filter.color(it) } : {}"
            @click="goScheduleCourse(it.code)"
          >{{ it.code }}{{ filter.active ? ' ' + it.o.section : '' }}<span v-if="filter.active" class="do-inst">{{ briefInstructor(it.o.instructor) }}</span></span>
        </div>
        <div class="day-slot-empty" v-else>No offerings</div>
      </div>
    </div>
  `,
}
