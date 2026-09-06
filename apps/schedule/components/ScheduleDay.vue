<template>
  <div>
    <div class="detail-header nav-header">
      <button class="nav-arrow" aria-label="Previous day" @click="prevDay">←</button>
      <h2>{{ WEEKDAY_NAMES[day] }}</h2>
      <button class="nav-arrow" aria-label="Next day" @click="nextDay">→</button>
    </div>
    <DayTimeline />
  </div>
</template>

<script>
import { useRoute } from 'vue-router'
import { WEEKDAYS, WEEKDAY_NAMES } from '@major-vis/schedule-core'
import { goScheduleDay } from '../router.js'
import DayTimeline from './DayTimeline.vue'

import { computed } from 'vue'

export default {
  name: 'ScheduleDay',
  components: { DayTimeline },
  setup() {
    const route = useRoute()
    const day = computed(() => String(route.params.day || ''))

    const dayIndex = computed(() => WEEKDAYS.indexOf(day.value))
    const prevDay = () => goScheduleDay(WEEKDAYS[(dayIndex.value + WEEKDAYS.length - 1) % WEEKDAYS.length])
    const nextDay = () => goScheduleDay(WEEKDAYS[(dayIndex.value + 1) % WEEKDAYS.length])

    return {
      day,
      WEEKDAY_NAMES,
      prevDay,
      nextDay,
    }
  },
}
</script>
