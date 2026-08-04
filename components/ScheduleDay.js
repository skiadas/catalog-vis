import { route } from '../lib/router.js'
import { WEEKDAY_NAMES, SLOT_BLOCKS, formatTime, slotKey, colorForDept, briefInstructor } from '../lib/schedule.js'
import { schedule, selectedDepartments } from '../lib/store.js'
import { goScheduleSlot, goScheduleCourse, goScheduleGrid } from '../lib/router.js'

const { computed } = Vue

export default {
  name: 'ScheduleDay',
  setup() {
    const day = computed(() => route.value.params.day)
    const slots = computed(() => {
      const out = []
      for (const block of SLOT_BLOCKS) {
        const days = block.label
        if (!days.includes(day.value)) continue
        for (const slot of block.slots) {
          let items = schedule.value.bySlot[slotKey(day.value, slot.time)] || []
          if (selectedDepartments.value.length) {
            items = items.filter(it => selectedDepartments.value.includes(it.o.prefix))
          }
          if (items.length) {
            out.push({ ...slot, days: block.label, items })
          }
        }
      }
      return out
    })
    const isFiltering = computed(() => selectedDepartments.value.length > 0)
    return { day, slots, isFiltering, WEEKDAY_NAMES, formatTime, colorForDept, briefInstructor, goScheduleSlot, goScheduleCourse, goScheduleGrid }
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
            :class="{ 'dept-colored': isFiltering }"
            :style="isFiltering ? { backgroundColor: colorForDept(it.o.prefix) } : {}"
            @click="goScheduleCourse(it.code)"
          >{{ it.code }}{{ isFiltering ? ' ' + it.o.section : '' }}<span v-if="isFiltering" class="do-inst">{{ briefInstructor(it.o.instructor) }}</span></span>
        </div>
        <div class="day-slot-empty" v-else>No offerings</div>
      </div>
    </div>
  `
}