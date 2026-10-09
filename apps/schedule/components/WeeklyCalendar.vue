<template>
  <div class="calendar-scroll">
    <div class="calendar" :style="calStyle">
      <div class="cal-row cal-header">
        <div class="cal-time-head"></div>
        <button
          type="button"
          class="cal-dayhead"
          v-for="d in WEEKDAYS"
          :key="d"
          @click="onDayClick && onDayClick(d)"
        >
          {{ d }}<span class="day-name">{{ WEEKDAY_NAMES[d] }}</span>
        </button>
      </div>

      <div class="cal-row cal-body">
        <div class="cal-ruler">
          <div
            v-for="h in hours"
            :key="h.min"
            class="cal-hour"
            :class="{ 'cal-hour-end': h.min === range.end }"
            :style="{ top: topOffset(h.min) }"
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
import {
  WEEKDAYS,
  WEEKDAY_NAMES,
  hourMarks,
  DAY_START_MIN,
  DAY_END_MIN,
  PX_PER_MIN,
} from '@major-vis/schedule-core'
import { computed } from 'vue'

export default {
  name: 'WeeklyCalendar',
  props: {
    onDayClick: { type: Function, default: null },
    striped: { type: Boolean, default: false },
    // { start, end } minutes of the visible day range (defaults to the standard
    // working day); a class extending past 16:00 renders via this range.
    range: { type: Object, default: null },
    // Vertical-scale multiplier on `PX_PER_MIN` (the crowded-view doubling);
    // callers that don't scale (e.g. the instructor view) keep the base scale.
    scale: { type: Number, default: 1 },
  },
  setup(props) {
    // Derived from the props reactively so a term change (a different `range`)
    // or the height control (a different `scale`) re-lays the whole grid.
    const range = computed(() =>
      props.range && props.range.start != null ? props.range : { start: DAY_START_MIN, end: DAY_END_MIN },
    )
    const hours = computed(() => hourMarks(range.value.start, range.value.end))
    const px = (minutes) => minutes * PX_PER_MIN * props.scale
    const topOffset = (min) => px(min - range.value.start) + 'px'
    // The columns and ruler grow with the range and scale so a lone hour label
    // never overhangs the grid's box.
    const calStyle = computed(() => ({ '--cal-height': px(range.value.end - range.value.start) + 'px' }))
    return { WEEKDAYS, WEEKDAY_NAMES, hours, topOffset, calStyle, range }
  },
}
</script>
