<template>
  <div>
    <button class="back-btn" @click="goScheduleDay(day)">← {{ WEEKDAY_NAMES[day] }}</button>
    <div class="detail-header nav-header">
      <button class="nav-arrow nav-day" title="Previous day" @click="prevDay">⇤</button>
      <button class="nav-arrow" title="Previous slot" @click="prevSlot">←</button>
      <h2>{{ WEEKDAY_NAMES[day] }} · {{ formatTime(time) }}</h2>
      <button class="nav-arrow" title="Next slot" @click="nextSlot">→</button>
      <button class="nav-arrow nav-day" title="Next day" @click="nextDay">⇥</button>
    </div>

    <div class="section-title">Offerings ({{ items.length }})</div>
    <div v-if="!items.length" class="empty-state"><p>No offerings in this slot.</p></div>
    <div class="slot-pills" v-else>
      <CoursePill
        v-for="it in items"
        :key="it.code + it.o.section + it.sid"
        :item="it"
        :filter-active="filter.active"
        :color="filter.color(it)"
        :editable="isEditable(it)"
        :proposed="proposalFor(it) ? itemTitle(it) : ''"
        :removed="removalFor(it) ? itemTitle(it) : ''"
        @edit="openCourseEdit(it)"
      />
    </div>
  </div>
</template>

<script>
import { useRoute } from 'vue-router'
import {
  WEEKDAYS,
  WEEKDAY_NAMES,
  formatTime,
  slotKey,
  buildIndex,
  buildVisual,
  buildEditVisual,
  proposeOverlay,
  colorForSchedule,
  termSlotOptions,
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
  openCourseEdit,
} from '../src/scheduleStore.js'
import { goScheduleCourse, goScheduleDay, goScheduleSlot } from '../router.js'
import CoursePill from './CoursePill.vue'

import { computed } from 'vue'

export default {
  name: 'ScheduleSlot',
  components: { CoursePill },
  setup() {
    const route = useRoute()
    const day = computed(() => String(route.params.day || ''))
    const time = computed(() => String(route.params.time || ''))

    // Pending-suggestion overlay for this slot's index (see ScheduleGrid).
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
    // session schedule's courses are visible — an active filter still limits.
    // Pending proposals force the pill view so proposed blocks are visible.
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

    const items = computed(() => {
      if (!shownIndex.value) return []
      let list = shownIndex.value.bySlot[slotKey(day.value, time.value)] || []
      if (filter.value.active) {
        list = list.filter((it) => filter.value.matches(it))
      }
      return list
    })

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
    const times = computed(() => termSlotOptions(activeTerm.value, day.value).map((s) => s.time))
    const timeIndex = computed(() => times.value.indexOf(time.value))
    const dayIndex = computed(() => WEEKDAYS.indexOf(day.value))
    const prevDay = () => {
      const d = WEEKDAYS[(dayIndex.value + WEEKDAYS.length - 1) % WEEKDAYS.length]
      goScheduleSlot(d, termSlotOptions(activeTerm.value, d)[0]?.time)
    }
    const nextDay = () => {
      const d = WEEKDAYS[(dayIndex.value + 1) % WEEKDAYS.length]
      goScheduleSlot(d, termSlotOptions(activeTerm.value, d)[0]?.time)
    }
    const prevSlot = () =>
      times.value.length
        ? goScheduleSlot(
            day.value,
            times.value[(timeIndex.value + times.value.length - 1) % times.value.length],
          )
        : null
    const nextSlot = () =>
      times.value.length
        ? goScheduleSlot(day.value, times.value[(timeIndex.value + 1) % times.value.length])
        : null
    const isEditable = (it) => editingScheduleId.value != null && it.sid === editingScheduleId.value
    return {
      day,
      time,
      items,
      times,
      timeIndex,
      prevDay,
      nextDay,
      prevSlot,
      nextSlot,
      filter,
      WEEKDAY_NAMES,
      formatTime,
      goScheduleCourse,
      goScheduleDay,
      isEditable,
      proposalFor,
      removalFor,
      itemTitle,
      openCourseEdit,
    }
  },
}
</script>
