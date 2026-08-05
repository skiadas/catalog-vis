import { route } from '../lib/router.js'
import { WEEKDAYS, WEEKDAY_NAMES, SLOT_BLOCKS, formatTime, slotKey, buildFilter } from '../lib/schedule.js'
import { schedule, selectedDepartments, selectedInstructors, filterMode } from '../lib/store.js'
import { goScheduleSlot, goScheduleCourse, goScheduleDay } from '../lib/router.js'
import CoursePill from './CoursePill.js'

const { computed } = Vue

export default {
  name: 'ScheduleDay',
  components: { CoursePill },
  setup() {
    const day = computed(() => route.value.params.day)
    const filter = computed(() =>
      buildFilter(filterMode.value, selectedDepartments.value, selectedInstructors.value),
    )
    const dayIndex = computed(() => WEEKDAYS.indexOf(day.value))
    const prevDay = () => goScheduleDay(WEEKDAYS[(dayIndex.value + WEEKDAYS.length - 1) % WEEKDAYS.length])
    const nextDay = () => goScheduleDay(WEEKDAYS[(dayIndex.value + 1) % WEEKDAYS.length])
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
      prevDay,
      nextDay,
      WEEKDAY_NAMES,
      formatTime,
      goScheduleSlot,
      goScheduleCourse,
    }
  },
  template: `
    <div>
      <div class="detail-header nav-header">
        <button class="nav-arrow" @click="prevDay">←</button>
        <h2>{{ WEEKDAY_NAMES[day] }}</h2>
        <button class="nav-arrow" @click="nextDay">→</button>
      </div>
      <p class="results-count" v-if="!slots.length">No classes scheduled this day.</p>

      <div class="day-slot-card" v-for="s in slots" :key="s.time">
        <div class="day-slot-head" @click="goScheduleSlot(day, s.time)">
          <span class="day-slot-time">{{ formatTime(s.time) }}</span>
          <span class="day-slot-count">{{ s.items.length }} offering{{ s.items.length !== 1 ? 's' : '' }}</span>
        </div>
        <div class="day-slot-items" v-if="s.items.length">
          <CoursePill
            v-for="it in s.items"
            :key="it.code + it.o.section"
            :item="it"
            :filter-active="filter.active"
            :color="filter.color(it)"
          />
        </div>
        <div class="day-slot-empty" v-else>No offerings</div>
      </div>
    </div>
  `,
}
