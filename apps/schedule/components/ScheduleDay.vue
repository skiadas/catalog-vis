<template>
  <div>
    <div class="detail-header nav-header">
      <button class="nav-arrow" @click="prevDay">←</button>
      <h2>{{ WEEKDAY_NAMES[day] }}</h2>
      <button class="nav-arrow" @click="nextDay">→</button>
    </div>
    <p class="results-count" v-if="!hasAny">No classes scheduled this day.</p>

    <div
      v-for="t in dayTimes"
      :key="t.time"
      class="day-slot-card"
      :class="{ 'drag-over': dragOver === t.key }"
      @dragover="zoneOver($event, t)"
      @dragleave="zoneLeave"
      @drop="zoneDrop($event, t)"
    >
      <div class="day-slot-head" @click="goScheduleSlot(day, t.time)">
        <span class="day-slot-time">{{ formatTime(t.time) }}</span>
        <span class="day-slot-count"
          >{{ itemsFor(t.time).length }} offering{{ itemsFor(t.time).length !== 1 ? 's' : '' }}</span
        >
      </div>
      <div class="day-slot-items" v-if="itemsFor(t.time).length">
        <CoursePill
          v-for="it in itemsFor(t.time)"
          :key="it.code + it.o.section + it.sid"
          :item="it"
          :filter-active="filter.active"
          :color="filter.color(it)"
          :editable="isEditable(it)"
          :draggable="isEditable(it)"
          :drag-day="day"
          :proposed="proposalFor(it) ? itemTitle(it) : ''"
          :removed="removalFor(it) ? itemTitle(it) : ''"
          @edit="openCourseEdit(it)"
        />
      </div>
      <div class="day-slot-empty" v-else>No offerings</div>
    </div>
  </div>
</template>

<script>
import { route } from '../router.js'
import {
  WEEKDAYS,
  WEEKDAY_NAMES,
  termSlotOptions,
  termDayGroup,
  formatTime,
  slotKey,
  buildIndex,
  buildVisual,
  buildEditVisual,
  proposeOverlay,
  colorForSchedule,
} from '@major-vis/schedule-core'
import { selectedDepartments, selectedInstructors, filterMode, activeTerm } from '../src/scheduleStore.js'
import {
  schedule,
  scheduleOfferings,
  selectedScheduleIds,
  colorSchedules,
  editingScheduleId,
  showPendingSuggestions,
  pendingSuggestionsForTerm,
  moveOffering,
  openCourseEdit,
} from '../src/scheduleStore.js'
import { goScheduleSlot, goScheduleCourse, goScheduleDay } from '../router.js'
import { useScheduleDrag } from '../scheduleDrag.js'
import CoursePill from './CoursePill.vue'

import { computed } from 'vue'

export default {
  name: 'ScheduleDay',
  components: { CoursePill },
  setup() {
    const day = computed(() => route.value.params.day)
    const dayGroup = (d) => termDayGroup(activeTerm.value, d)

    // Pending-suggestion overlay for this day's index (see ScheduleGrid).
    const overlay = computed(() => {
      if (!showPendingSuggestions.value) return { extra: [], removalsByKey: new Map() }
      const list = pendingSuggestionsForTerm.value
      if (!list.length) return { extra: [], removalsByKey: new Map() }
      const { proposed, removals } = proposeOverlay(scheduleOfferings.value, list)
      const removalsByKey = new Map()
      for (const r of removals) {
        removalsByKey.set(`${r.cur.prefix} ${r.cur.number} ${r.cur.section}`, r)
      }
      return { extra: proposed, aware: true, removalsByKey }
    })

    const shownIndex = computed(() => {
      const extra = overlay.value.extra || []
      if (!extra.length) return schedule.value
      const merged = [
        ...scheduleOfferings.value,
        ...extra.map((p, i) => ({
          ...p.offering,
          $sid: 'prop:' + p.suggestionId + ':' + i,
          $prop: p,
        })),
      ]
      return buildIndex(merged)
    })

    // In edit/suggest mode the filter is overridden (like the grid) so the
    // session schedule's courses are visible, individually colored, and
    // editable — while an active filter still limits. Pending proposals force
    // the pill view so proposed blocks are visible.
    const filter = computed(() => {
      if (editingScheduleId.value) {
        return buildEditVisual(filterMode.value, selectedDepartments.value, selectedInstructors.value, (it) =>
          colorForSchedule(it.sid),
        )
      }
      const visual = buildVisual(
        filterMode.value,
        selectedDepartments.value,
        selectedInstructors.value,
        selectedScheduleIds.value,
        colorSchedules.value,
      )
      if (!visual.active && overlay.value.aware) {
        return { active: true, matches: () => true, color: (it) => colorForSchedule(it.sid) }
      }
      return visual
    })

    const dayIndex = computed(() => WEEKDAYS.indexOf(day.value))
    const prevDay = () => goScheduleDay(WEEKDAYS[(dayIndex.value + WEEKDAYS.length - 1) % WEEKDAYS.length])
    const nextDay = () => goScheduleDay(WEEKDAYS[(dayIndex.value + 1) % WEEKDAYS.length])

    // The assignable time bands for the day in the active term, in order:
    // occupied ones render as offering cards, empty ones as drop targets.
    const dayTimes = computed(() =>
      termSlotOptions(activeTerm.value, day.value).map((s) => ({
        key: s.time,
        day: day.value,
        days: dayGroup(day.value),
        ...s,
      })),
    )
    const itemsFor = (time) => {
      let items = shownIndex.value.bySlot[slotKey(day.value, time)] || []
      if (filter.value.active) items = items.filter((it) => filter.value.matches(it))
      return items
    }
    const hasAny = computed(() => dayTimes.value.some((t) => itemsFor(t.time).length > 0))

    const proposalFor = (it) => (it.o && it.o.$prop) || null
    const removalFor = (it) => overlay.value.removalsByKey.get(`${it.code} ${it.o.section}`) || null
    const itemTitle = (it) => {
      const prop = proposalFor(it)
      if (prop) {
        return `${it.code}${it.o.section}: proposed ${prop.kind === 'move' ? 'move' : 'add'} by ${prop.proposer}`
      }
      const rem = removalFor(it)
      if (rem) return `${it.code}${it.o.section}: removal proposed by ${rem.proposer}`
      return ''
    }

    // Drag-and-drop between this day's slots (edit mode only).
    const { dragOver, isEditable, zoneOver, zoneLeave, zoneDrop } = useScheduleDrag(
      editingScheduleId,
      moveOffering,
    )

    return {
      day,
      dayTimes,
      itemsFor,
      hasAny,
      filter,
      prevDay,
      nextDay,
      WEEKDAY_NAMES,
      formatTime,
      goScheduleSlot,
      goScheduleCourse,
      isEditable,
      proposalFor,
      removalFor,
      itemTitle,
      dragOver,
      zoneOver,
      zoneLeave,
      zoneDrop,
      openCourseEdit,
    }
  },
}
</script>
