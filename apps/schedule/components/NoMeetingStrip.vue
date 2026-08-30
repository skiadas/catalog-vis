<template>
  <div v-if="items.length" class="no-meeting-strip">
    <div class="no-meeting-head">
      <h3 class="no-meeting-title">No meeting times</h3>
      <span class="no-meeting-count">{{ items.length }}</span>
    </div>
    <p class="no-meeting-hint">
      These courses aren't placed on the calendar — a no-meeting course is a choice (independent studies and
      the like), and custom times outside the day's hours have nowhere to sit on the grid.
      <template v-if="editMode"
        >Drag one onto a time slot to give it a meeting time, or click the pencil to edit it.</template
      >
    </p>
    <div class="no-meeting-list">
      <div v-for="it in items" :key="it.code + ' ' + it.o.section + ' ' + it.sid" class="no-meeting-row">
        <CoursePill
          :item="it"
          :filter-active="filter.active"
          :color="filter.active ? filter.color(it) : ''"
          :editable="editMode"
          :draggable="editMode"
          :drag-day="''"
          @edit="openCourseEdit(it)"
        />
        <span class="no-meeting-pattern">{{
          it.o.days && it.o.time ? `Custom · ${formatTime(it.o.time)}` : 'No meeting time'
        }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { WEEKDAYS, daySlotBlocks, clipBand, calendarDayRange, formatTime } from '@major-vis/schedule-core'
import { schedule, activeTerm, editingScheduleId, openCourseEdit } from '../src/scheduleStore.js'
import CoursePill from './CoursePill.vue'

import { computed } from 'vue'

// Courses that never appear on the calendar grid for the active term:
// no-meeting-time offerings plus scheduled ones whose band lies entirely
// outside the term's rendered hours (e.g. a 6pm class in Fall). Both are
// deliberate choices, so they live in this strip with their pattern shown.
export default {
  name: 'NoMeetingStrip',
  components: { CoursePill },
  props: {
    filter: { type: Object, required: true },
  },
  setup(props) {
    const items = computed(() => {
      const range = calendarDayRange(activeTerm.value)
      const out = [...(schedule.value.unscheduled || [])]
      const seen = new Set(out.map((it) => `${it.code} ${it.o.section} ${it.sid}`))
      for (const d of WEEKDAYS) {
        for (const b of daySlotBlocks(d, schedule.value)) {
          if (clipBand(b, range)) continue
          for (const it of b.items) {
            const key = `${it.code} ${it.o.section} ${it.sid}`
            if (!seen.has(key)) {
              seen.add(key)
              out.push(it)
            }
          }
        }
      }
      if (props.filter.active) return out.filter((it) => props.filter.matches(it))
      return out
    })
    const editMode = computed(() => Boolean(editingScheduleId.value))
    return {
      items,
      editMode,
      formatTime,
      activeTerm,
      openCourseEdit,
    }
  },
}
</script>
