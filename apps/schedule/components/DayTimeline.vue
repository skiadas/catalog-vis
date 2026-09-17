<template>
  <div :class="{ 'drag-in-progress': dragging }">
    <div class="calendar-scroll">
      <div class="calendar day-timeline" :style="calStyle">
        <div class="cal-row cal-body">
          <div class="cal-ruler">
            <div
              v-for="h in hours"
              :key="h.min"
              class="cal-hour"
              :style="{ top: topOffset(h.min), height: hourHeight }"
            >
              {{ h.label }}
            </div>
          </div>
          <div class="cal-daycol day-timeline-col">
            <div v-for="g in hours" :key="g.min" class="cal-guide" :style="{ top: topOffset(g.min) }"></div>
            <!-- The day's standard bands as shaded background zones, so a custom
                 band's position relative to the standard structure is visible. -->
            <div
              v-for="z in stdZones"
              :key="z.time"
              class="tl-stdzone"
              :style="{ top: topOffset(z.start), height: (z.end - z.start) * PX_PER_MIN + 'px' }"
            ></div>
            <!-- Unoccupied standard slots accept a dragged course (edit mode). -->
            <div
              v-for="z in dropZones"
              :key="z.key"
              class="cal-block cal-dropzone"
              :class="{ over: dragOver === z.key }"
              :style="z.style"
              @dragover="zoneOver($event, z)"
              @dragleave="zoneLeave"
              @drop="zoneDrop($event, z)"
            ></div>
            <!-- Every meeting the day, standard or custom, on the shared axis;
                 overlapping bands lane-split so each stays readable. -->
            <div
              v-for="b in blocks"
              :key="b.key"
              class="cal-block day-tl-block"
              :class="{ 'off-pattern': b.offPattern, over: dragOver === zoneKey(b) }"
              :style="b.style"
              @dragover="zoneOver($event, zoneFor(b))"
              @dragleave="zoneLeave"
              @drop="zoneDrop($event, zoneFor(b))"
            >
              <div class="day-tl-head">
                <button type="button" class="day-tl-time" @click="goScheduleSlot(day, b.time)">
                  {{ formatTime(b.time) }}
                </button>
                <span v-if="b.offPattern" class="cal-block-tag">custom</span>
                <span class="day-tl-count"
                  >{{ b.items.length }} course{{ b.items.length !== 1 ? 's' : '' }}</span
                >
                <button
                  type="button"
                  class="cal-block-view"
                  :title="'View slot ' + formatTime(b.time)"
                  @click="goScheduleSlot(day, b.time)"
                >
                  View slot
                </button>
              </div>
              <div class="cal-block-depts">
                <OfferingRow
                  v-for="it in b.items"
                  :key="offeringItemKey(it)"
                  :item="it"
                  :color="rowColor(it)"
                  :editable="isEditable(it)"
                  :draggable="isEditable(it)"
                  :proposed="proposalFor(it) ? itemTitle(it) : ''"
                  :removed="removalFor(it) ? itemTitle(it) : ''"
                  @edit="openCourseEdit(it)"
                  @dragstart="onDragStart($event, it, day)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <p v-if="empty" class="results-count">No classes scheduled this day.</p>
  </div>
</template>

<script>
import { useRoute } from 'vue-router'
import {
  hourMarks,
  PX_PER_MIN,
  formatTime,
  buildIndex,
  buildVisual,
  buildEditVisual,
  proposeOverlay,
  colorForSchedule,
  termSlotOptions,
  termConfig,
  termDayGroup,
  clipBand,
  daySlotBlocks,
  dayTimelineRange,
  assignLanes,
  offeringItemKey,
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
import { goScheduleSlot } from '../router.js'
import { useScheduleDrag } from '../scheduleDrag.js'
import OfferingRow from './OfferingRow.vue'

import { computed } from 'vue'

// A single-day timeline: one column on the week grid's shared time scale, with
// the day's standard bands as shaded background zones and every meeting
// (standard or custom) as a positioned block. The axis auto-expands to cover
// the day's meetings; overlapping bands lane-split side by side.
export default {
  name: 'DayTimeline',
  components: { OfferingRow },
  setup() {
    const route = useRoute()
    const day = computed(() => String(route.params.day || ''))
    const dayGroup = (d) => termDayGroup(activeTerm.value, d)
    const zoneKey = (b) => dayGroup(day.value) + '|' + b.time

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
    // editable — while an active filter still limits.
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

    // The axis: the term's standard range at minimum, expanded (snapped to
    // half-hours) to the day's earliest/latest meeting, so early/evening
    // custom classes render in full instead of clipping.
    const dayRange = computed(() => dayTimelineRange(activeTerm.value, shownIndex.value, day.value))
    const hours = computed(() => hourMarks(dayRange.value.start, dayRange.value.end))
    const topOffset = (min) => (min - dayRange.value.start) * PX_PER_MIN + 'px'
    const hourHeight = computed(() => 60 * PX_PER_MIN + 'px')
    const calStyle = computed(() => ({
      '--cal-height': (dayRange.value.end - dayRange.value.start) * PX_PER_MIN + 'px',
    }))

    // The day's standard bands, painted as pale zones behind everything.
    const stdZones = computed(() => {
      const config = termConfig(activeTerm.value)
      const group = config.dayGroups.find((g) => g.label.includes(day.value))
      return group ? group.slots.map((s) => ({ ...s })) : []
    })

    // Every band the day shows: `daySlotBlocks` splits standard/off-pattern,
    // out-of-range bands are a no-op here (the axis covers them) but the
    // guard stays, then a visual filter drops hidden blocks and overlaps get
    // lane assignments (touching bands share a lane, so the consecutive
    // standard slots stay stacked flush).
    const visibleBlocks = computed(() => {
      let blocks = daySlotBlocks(day.value, shownIndex.value, activeTerm.value)
        .filter((b) => clipBand(b, dayRange.value))
        // Standard bands anchor to the leftmost lanes; off-pattern/custom
        // bands fill in to their right (the grid's rail side).
        .map((b) => ({ ...b, laneRank: b.offPattern ? 1 : 0 }))
      if (filter.value.active) {
        blocks = blocks
          .map((b) => ({ ...b, items: b.items.filter((it) => filter.value.matches(it)) }))
          .filter((b) => b.items.length)
      }
      return assignLanes(blocks)
    })

    // Lane geometry: each block takes an equal share with a 4px seam between
    // lanes; the first lane sits at the grid's 4px inset so a single block
    // spans the column exactly like a grid bar.
    const styleFor = (b) => {
      const seam = 4
      const span = `calc((100% - ${8 + (b.laneCount - 1) * seam}px) / ${b.laneCount})`
      return {
        top: (b.start - dayRange.value.start) * PX_PER_MIN + 'px',
        height: (b.end - b.start) * PX_PER_MIN + 'px',
        left: `calc(${b.lane} * (${span} + ${seam}px) + 4px)`,
        width: span,
      }
    }

    const blocks = computed(() =>
      visibleBlocks.value.map((b) => ({
        ...b,
        key: `${day.value}|${b.time}|${b.offPattern ? 'off' : 'std'}`,
        style: styleFor(b),
      })),
    )

    // Unoccupied standard bands render as drop targets when dragging (edit
    // mode): the same zone shape the grid uses.
    const dropZones = computed(() => {
      const occupied = new Set(visibleBlocks.value.map((b) => b.time))
      return termSlotOptions(activeTerm.value, day.value)
        .filter((s) => !occupied.has(s.time))
        .map((s) => ({
          key: zoneKey(s),
          day: day.value,
          days: dayGroup(day.value),
          time: s.time,
          style: {
            top: (s.start - dayRange.value.start) * PX_PER_MIN + 'px',
            height: (s.end - s.start) * PX_PER_MIN + 'px',
          },
        }))
    })

    // Row-chip color: the active filter's color when one is on, otherwise the
    // schedule color (inactive visuals never leave rows white-on-white).
    const rowColor = (it) => (filter.value.active ? filter.value.color(it) : colorForSchedule(it.sid))

    const proposalFor = (it) => (it.o && it.o.$prop) || null
    const removalFor = (it) => overlay.value.removalsByKey.get(`${it.code} ${it.o.section}`) || null
    const itemTitle = (it) => {
      const prop = proposalFor(it)
      if (prop) {
        return `${it.code}${it.o.section}: proposed ${prop.kind === 'move' ? 'move' : 'add'} by ${prop.proposer}`
      }
      const rem = removalFor(it)
      if (rem) return `${it.code}${it.o.section}: removal proposed by ${rem.proposer}`
      // Team-taught courses list the full roster in the tooltip.
      if ((it.instructors || []).length > 1) return it.instructors.join(', ')
      return ''
    }

    const zoneFor = (b) => ({
      key: zoneKey(b),
      day: day.value,
      days: dayGroup(day.value),
      time: b.time,
    })

    const { dragOver, dragging, isEditable, onDragStart, zoneOver, zoneLeave, zoneDrop } = useScheduleDrag(
      editingScheduleId,
      moveOffering,
    )

    const empty = computed(() => blocks.value.length === 0)

    return {
      day,
      hours,
      topOffset,
      hourHeight,
      calStyle,
      stdZones,
      dropZones,
      blocks,
      zoneKey,
      zoneFor,
      PX_PER_MIN,
      formatTime,
      goScheduleSlot,
      rowColor,
      offeringItemKey,
      isEditable,
      proposalFor,
      removalFor,
      itemTitle,
      dragOver,
      dragging,
      onDragStart,
      zoneOver,
      zoneLeave,
      zoneDrop,
      openCourseEdit,
      empty,
    }
  },
}
</script>
