<template>
  <div class="calendar-scroll">
    <div class="calendar" :style="calStyle">
      <div class="cal-row cal-header">
        <div class="cal-time-head"></div>
        <div class="cal-dayhead" v-for="d in WEEKDAYS" :key="d" @click="onDayClick && onDayClick(d)">
          {{ d }}<span class="day-name">{{ WEEKDAY_NAMES[d] }}</span>
        </div>
      </div>

      <div class="cal-row cal-body">
        <div class="cal-ruler">
          <div
            v-for="h in hours"
            :key="h.min"
            class="cal-hour"
            :style="{ top: topOffset(h.min), height: '60px' }"
          >
            {{ h.label }}
          </div>
        </div>

        <div class="cal-daycol" :class="{ 'slot-striped': striped }" v-for="d in WEEKDAYS" :key="d">
          <div class="cal-guide" v-for="g in hours" :key="g.min" :style="{ top: topOffset(g.min) }"></div>
          <slot name="daycol" :day="d"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { WEEKDAYS, WEEKDAY_NAMES, hourMarks, DAY_START_MIN, DAY_END_MIN } from '@major-vis/schedule-core'

export default {
  name: 'WeeklyCalendar',
  props: {
    onDayClick: { type: Function, default: null },
    striped: { type: Boolean, default: false },
    // { start, end } minutes of the visible day range (defaults to the standard
    // working day); a class extending past 16:00 renders via this range.
    range: { type: Object, default: null },
  },
  setup(props) {
    const range =
      props.range && props.range.start != null ? props.range : { start: DAY_START_MIN, end: DAY_END_MIN }
    const hours = hourMarks(range.start, range.end)
    const topOffset = (min) => min - range.start + 'px'
    // The columns and ruler grow with the range (480px in Fall/Winter, 540px
    // in Spring) so a lone hour label never overhangs the grid's box.
    const calStyle = { '--cal-height': range.end - range.start + 'px' }
    return { WEEKDAYS, WEEKDAY_NAMES, hours, topOffset, calStyle }
  },
}
</script>
