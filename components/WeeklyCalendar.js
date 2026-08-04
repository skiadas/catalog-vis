import { WEEKDAYS, WEEKDAY_NAMES, hourMarks, DAY_START_MIN } from '../lib/schedule.js'

export default {
  name: 'WeeklyCalendar',
  props: {
    onDayClick: { type: Function, default: null },
  },
  setup() {
    const hours = hourMarks()
    const topOffset = (min) => min - DAY_START_MIN + 'px'
    return { WEEKDAYS, WEEKDAY_NAMES, hours, topOffset }
  },
  template: `
    <div class="calendar-scroll">
      <div class="calendar">
        <div class="cal-row cal-header">
          <div class="cal-time-head"></div>
          <div
            class="cal-dayhead"
            v-for="d in WEEKDAYS"
            :key="d"
            @click="onDayClick && onDayClick(d)"
          >{{ d }}<span class="day-name">{{ WEEKDAY_NAMES[d] }}</span></div>
        </div>

        <div class="cal-row cal-body">
          <div class="cal-ruler">
            <div
              v-for="h in hours"
              :key="h.min"
              class="cal-hour"
              :style="{ top: topOffset(h.min), height: '60px' }"
            >{{ h.label }}</div>
          </div>

          <div class="cal-daycol" v-for="d in WEEKDAYS" :key="d">
            <div
              class="cal-guide"
              v-for="g in hours"
              :key="g.min"
              :style="{ top: topOffset(g.min) }"
            ></div>
            <slot name="daycol" :day="d"></slot>
          </div>
        </div>
      </div>
    </div>
  `,
}
