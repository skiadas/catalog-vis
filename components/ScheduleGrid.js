import { WEEKDAYS, WEEKDAY_NAMES, daySlotBlocks, blockStyle, hourMarks, formatTime,
  buildFilter, briefInstructor } from '../lib/schedule.js'
import { schedule, selectedDepartments, selectedInstructors, filterMode } from '../lib/store.js'
import { goScheduleSlot, goScheduleDay, goScheduleCourse } from '../lib/router.js'

const { computed } = Vue

export default {
  name: 'ScheduleGrid',
  setup() {
    const slotTitle = (slot) => slot.items.map(it => it.code).join(', ')
    const hours = hourMarks()

    const filter = computed(() => buildFilter(filterMode.value, selectedDepartments.value, selectedInstructors.value))

    const dayBlocks = (day) => {
      const blocks = daySlotBlocks(day, schedule.value)
      if (!filter.value.active) return blocks
      const out = []
      for (const b of blocks) {
        const items = b.items.filter(it => filter.value.matches(it))
        if (items.length) out.push({ ...b, items })
      }
      return out
    }

    return { WEEKDAYS, WEEKDAY_NAMES, formatTime, hours,
      schedule, dayBlocks, blockStyle, slotTitle, briefInstructor, filter,
      goScheduleSlot, goScheduleDay, goScheduleCourse }
  },
  template: `
    <div>
      <div class="calendar-scroll">
        <div class="calendar">
          <div class="cal-row cal-header">
            <div class="cal-time-head"></div>
            <div class="cal-dayhead" v-for="d in WEEKDAYS" :key="d" @click="goScheduleDay(d)">
              {{ d }}<span class="day-name">{{ WEEKDAY_NAMES[d] }}</span>
            </div>
          </div>

          <div class="cal-row cal-body">
            <div class="cal-ruler">
              <div
                v-for="h in hours"
                :key="h.min"
                class="cal-hour"
                :style="{ top: (h.min - 480) + 'px', height: '60px' }"
              >{{ h.label }}</div>
            </div>

            <div class="cal-daycol" v-for="d in WEEKDAYS" :key="d">
              <div
                class="cal-guide"
                v-for="g in hours"
                :key="g.min"
                :style="{ top: (g.min - 480) + 'px' }"
              ></div>

              <div
                v-for="slot in dayBlocks(d)"
                :key="slot.time"
                class="cal-block"
                :class="{ filtered: filter.active }"
                :title="slotTitle(slot)"
                :style="blockStyle(slot)"
                @click="goScheduleSlot(d, slot.time)"
              >
                <template v-if="filter.active">
                  <div class="cal-block-time">{{ formatTime(slot.time) }}</div>
                  <div class="cal-block-depts">
                    <span
                      v-for="it in slot.items"
                      :key="it.code + it.o.section"
                      class="dept-offering"
                      :style="{ backgroundColor: filter.color(it) }"
                      @click.stop="goScheduleCourse(it.code)"
                    >{{ it.code }}{{ it.o.section }}<span class="do-inst">{{ briefInstructor(it.o.instructor) }}</span></span>
                  </div>
                </template>
                <template v-else>
                  <div class="cal-block-count">{{ slot.items.length }} <span class="cal-block-label">course{{ slot.items.length !== 1 ? 's' : '' }}</span></div>
                  <div class="cal-block-time">{{ formatTime(slot.time) }}</div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
}