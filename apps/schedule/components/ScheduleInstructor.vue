<template>
  <div>
    <div class="course-picker" v-if="instructors.length">
      <label for="schedule-instructor-select">Instructor:</label>
      <select
        id="schedule-instructor-select"
        class="search-input"
        style="max-width: 220px; flex: 0 0 auto"
        :value="name"
        @change="onInstructorChange"
      >
        <option v-for="i in instructors" :key="i" :value="i">{{ instructorName(i) }}</option>
      </select>
    </div>

    <div v-if="!name" class="empty-state"><p>Select an instructor to view their timetable.</p></div>
    <div v-else>
      <div class="detail-header">
        <h2>{{ instructorName(name) }}</h2>
        <div class="faculty">{{ items.length }} offering{{ items.length !== 1 ? 's' : '' }}</div>
      </div>

      <div class="section-title" :class="{ alert: conflicts.length }">
        Conflicts
        <span v-if="conflicts.length" class="conflict-badge">{{ conflicts.length }}</span>
      </div>
      <div v-if="!conflicts.length" class="results-count">No double-bookings detected.</div>
      <div v-for="c in conflicts" :key="c.a.code + c.a.o.time + c.b.code + c.b.o.time" class="conflict-alert">
        <strong>{{ instructorName(name) }}</strong> is double-booked: {{ c.a.code }}({{ c.a.o.section }})
        {{ c.a.o.days }}
        {{ c.a.o.time }} overlaps {{ c.b.code }}({{ c.b.o.section }}) {{ c.b.o.days }} {{ c.b.o.time }}.
      </div>

      <div style="margin-top: 20px">
        <div class="section-title">Weekly timetable</div>
        <WeeklyCalendar>
          <template #daycol="{ day }">
            <button
              v-for="b in dayItems(day)"
              :key="b.key"
              type="button"
              class="cal-block teach"
              :class="{ proposed: proposed(b.it), removed: removed(b.it) }"
              :title="itemTitle(b.it)"
              :style="b.style"
              @click="goScheduleCourse(b.it.code)"
            >
              <div class="cal-block-count">{{ b.it.code }}{{ b.it.o.section }}</div>
            </button>
          </template>
        </WeeklyCalendar>
      </div>
    </div>
  </div>
</template>

<script>
import { useRoute } from 'vue-router'
import {
  shownSchedule,
  overlayProposal,
  overlayRemoval,
  overlayTitle,
  instructorName,
} from '../src/scheduleStore.js'
import {
  instructorConflicts,
  compareInstructors,
  DAY_START_MIN,
  PX_PER_MIN,
  offeringItemKey,
} from '@major-vis/schedule-core'
import { goScheduleCourse, goScheduleSlot, goScheduleInstructor } from '../router.js'
import WeeklyCalendar from './WeeklyCalendar.vue'

import { computed } from 'vue'

export default {
  name: 'ScheduleInstructor',
  components: { WeeklyCalendar },
  setup() {
    const route = useRoute()
    const instructors = computed(() =>
      shownSchedule.value ? Object.keys(shownSchedule.value.byInstructor).sort(compareInstructors) : [],
    )
    const name = computed(() => String(route.params.instructor || ''))
    const items = computed(
      () => (shownSchedule.value && name.value ? shownSchedule.value.byInstructor[name.value] : []) || [],
    )
    const conflicts = computed(() => {
      if (!shownSchedule.value) return []
      return instructorConflicts(shownSchedule.value).filter((c) => c.instructor === name.value)
    })
    // Pending-suggestion markers on this instructor's timetable blocks.
    const proposed = (it) => Boolean(overlayProposal(it.o))
    const removed = (it) => overlayRemoval(it.o)
    const itemTitle = (it) => overlayTitle(it.o, it.code)
    const itemStyle = (it) => ({
      top: (it.start - DAY_START_MIN) * PX_PER_MIN + 'px',
      height: (it.end - it.start) * PX_PER_MIN + 'px',
    })
    const itemsInDay = (day) =>
      items.value.filter((it) => it.days.includes(day)).sort((a, b) => a.start - b.start)
    const dayItems = (day) =>
      itemsInDay(day).map((it) => ({
        key: offeringItemKey(it),
        it,
        style: itemStyle(it),
      }))
    const onInstructorChange = (e) => goScheduleInstructor(e.target.value)
    return {
      instructors,
      name,
      items,
      conflicts,
      proposed,
      removed,
      itemTitle,
      dayItems,
      onInstructorChange,
      instructorName,
      goScheduleCourse,
      goScheduleSlot,
      goScheduleInstructor,
    }
  },
}
</script>
