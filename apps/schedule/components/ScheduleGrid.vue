<template>
  <div :class="{ 'drag-in-progress': dragging }">
    <WeeklyCalendar :on-day-click="goScheduleDay" :striped="filter.active" :range="dayRange">
      <template #daycol="{ day }">
        <div
          v-for="z in dropZones(day)"
          :key="z.key"
          class="cal-block cal-dropzone"
          :class="{ over: dragOver === z.key }"
          :style="z.style"
          @dragover="zoneOver($event, z)"
          @dragleave="zoneLeave"
          @drop="zoneDrop($event, z)"
        ></div>
        <div
          v-for="b in blocksInDay(day)"
          :key="b.key"
          class="cal-block"
          :class="{
            filtered: b.active,
            open: isOpen(b.key),
            subsumed: b.subsumed,
            over: dragOver === dayGroup(day) + '|' + b.slot.time,
            'off-pattern': b.offPattern,
            'clipped-top': b.clippedTop,
            'clipped-bottom': b.clippedBottom,
          }"
          :title="b.title"
          :style="b.style"
          tabindex="0"
          @click="toggleOpen(b.key)"
          @keydown="onKeyActivate($event, () => toggleOpen(b.key))"
          @dragover="
            zoneOver($event, {
              key: dayGroup(day) + '|' + b.slot.time,
              day,
              days: dayGroup(day),
              time: b.slot.time,
            })
          "
          @dragleave="zoneLeave"
          @drop="zoneDrop($event, { day, days: dayGroup(day), time: b.slot.time })"
        >
          <template v-if="filter.active || isOpen(b.key)">
            <span v-if="b.offPattern" class="cal-block-tag">custom</span>
            <div class="cal-block-time">{{ formatTime(b.slot.time) }}</div>
            <div class="cal-block-depts">
              <span
                v-for="it in b.slot.items"
                :key="it.code + it.o.section + it.sid"
                class="filter-offering"
                :class="{ draggable: isEditable(it), proposed: proposalFor(it), removed: removalFor(it) }"
                :style="{ backgroundColor: rowColor(it) }"
                :draggable="isEditable(it)"
                tabindex="0"
                @click.stop="goScheduleCourse(it.code)"
                @keydown="onKeyActivate($event, () => goScheduleCourse(it.code))"
                @dragstart="onDragStart($event, it, day)"
                :title="itemTitle(it) || (isEditable(it) ? 'Drag to move' : '')"
              >
                <span class="filter-offering-main"
                  >{{ it.code }}{{ it.o.section
                  }}<span class="do-inst">{{ instructorChip(it.o).label }}</span></span
                >
                <button
                  v-if="isEditable(it)"
                  class="filter-offering-edit"
                  :title="'Edit ' + it.code"
                  aria-label="Edit course"
                  @click.stop="openCourseEdit(it)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                </button>
              </span>
            </div>
            <button class="cal-block-view" @click.stop="goScheduleSlot(day, b.slot.time)">View slot</button>
          </template>
          <template v-else>
            <div class="cal-block-count">
              {{ b.slot.items.length }}
              <span class="cal-block-label">course{{ b.slot.items.length !== 1 ? 's' : '' }}</span>
            </div>
            <div v-if="b.offPattern" class="cal-block-tag">custom</div>
            <div class="cal-block-time">{{ formatTime(b.slot.time) }}</div>
          </template>
        </div>
      </template>
    </WeeklyCalendar>
    <NoMeetingStrip :filter="filter" />
  </div>
</template>

<script>
import {
  buildIndex,
  daySlotBlocks,
  formatTime,
  buildVisual,
  buildEditVisual,
  proposeOverlay,
  briefInstructor,
  instructorChip,
  termSlotOptions,
  termDayGroup,
  toMinutes,
  calendarDayRange,
  clipBand,
  colorForSchedule,
} from '@major-vis/schedule-core'
import {
  selectedDepartments,
  selectedInstructors,
  filterMode,
  activeTerm,
  blockMode,
} from '../src/scheduleStore.js'
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
import { goScheduleSlot, goScheduleDay, goScheduleCourse } from '../router.js'
import { useScheduleDrag } from '../scheduleDrag.js'
import { onKeyActivate } from '../src/keyboardNav.js'
import WeeklyCalendar from './WeeklyCalendar.vue'
import NoMeetingStrip from './NoMeetingStrip.vue'

import { computed, ref } from 'vue'

// The day-group a weekday column belongs to, per the active term (e.g. MWF days
// are M/W/F, TR days T/R; Spring is a single MTWRF group).
function dayGroup(day) {
  return termDayGroup(activeTerm.value, day)
}

export default {
  name: 'ScheduleGrid',
  components: { WeeklyCalendar, NoMeetingStrip },
  setup() {
    const slotTitle = (slot) => slot.items.map((it) => it.code).join(', ')

    // Pending-suggestion overlay: each pending proposal's ops are interpreted
    // against the published term independently, so concurrent moves from
    // different departments all render (dashed). Removal markers tag their
    // current blocks.
    const overlay = computed(() => {
      if (!showPendingSuggestions.value) return { extra: [], removalsByKey: new Map() }
      const list = pendingSuggestionsForTerm.value
      if (!list.length) return { extra: [], removalsByKey: new Map() }
      const { proposed, removals } = proposeOverlay(scheduleOfferings.value, list)
      const removalsByKey = new Map()
      for (const r of removals) {
        removalsByKey.set(`${r.cur.prefix} ${r.cur.number} ${r.cur.section}`, r)
      }
      return {
        extra: proposed,
        aware: true,
        removalsByKey,
      }
    })

    // The index rendered on the calendar: the published schedules plus the
    // proposed offerings (each tagged with its suggestion so it colors and
    // labels distinctly and is never draggable).
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

    // In edit/suggest mode we force the per-course colored view so the session
    // schedule's courses are individually visible (and draggable), while an
    // active department/instructor filter still limits the display. Otherwise
    // the normal filter / schedule-coloring behavior applies — and when pending
    // proposals are shown, the view activates (pills + schedule colors) so the
    // proposed blocks are visible rather than hidden behind count summaries.
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

    // Opening a grid block brings its course list to the forefront in place
    // (one block at a time) instead of navigating away; an opened block's
    // "View slot" link still reaches the slot page.
    const openKey = ref(null)
    const blockKey = (day, slot) => `${day}|${slot.time}`
    const isOpen = (key) => openKey.value === key
    const toggleOpen = (key) => {
      openKey.value = openKey.value === key ? null : key
    }

    // Row chip color for an opened block's list: the active filter's color when
    // one is on, otherwise the schedule color (so summary-view rows are never
    // white-on-white — an inactive visual's `color()` is an empty string).
    const rowColor = (it) => (filter.value.active ? filter.value.color(it) : colorForSchedule(it.sid))

    const dayBlocks = (day) => {
      const blocks = daySlotBlocks(day, shownIndex.value, activeTerm.value)
      // Block-type view mode: 'all' shows bars + rails, 'normal' bars only,
      // 'custom' rails only.
      const mode = blockMode.value
      const visible = mode === 'all' ? blocks : blocks.filter((b) => (mode === 'custom') === b.offPattern)
      if (!filter.value.active) return visible
      const out = []
      for (const b of visible) {
        const items = b.items.filter((it) => filter.value.matches(it))
        if (items.length) out.push({ ...b, items })
      }
      return out
    }

    // The calendar is anchored to the term's standard hours so one off-pattern
    // early/late class never stretches the grid or hides normal classes; a
    // band outside it entirely is dropped from the grid and picked up by the
    // no-meeting-times strip instead.
    const dayRange = computed(() => calendarDayRange(activeTerm.value))
    // Position a band relative to the visible day range's start (1px/min),
    // clamped at the range edges (clipped classes keep their in-range portion).
    const blockStyleFor = (band) => {
      const clipped = clipBand(band, dayRange.value)
      return {
        top: clipped.start - dayRange.value.start + 'px',
        height: clipped.end - clipped.start + 'px',
        clippedTop: clipped.clippedTop,
        clippedBottom: clipped.clippedBottom,
      }
    }

    const blocksInDay = (day) =>
      dayBlocks(day)
        .map((slot) => ({ slot, clip: clipBand(slot, dayRange.value) }))
        .filter((x) => x.clip)
        .map(({ slot, clip }) => ({
          key: blockKey(day, slot),
          slot,
          style: {
            top: clip.start - dayRange.value.start + 'px',
            height: clip.end - clip.start + 'px',
          },
          // Off-pattern blocks (from the band split) render as half-width rails
          // so normal courses keep the full column.
          offPattern: slot.offPattern,
          // A squeezed rail exactly overlapping its standard sibling sits above
          // it (the rare case); everything else layers rails below the bars.
          subsumed: slot.sameSpan,
          clippedTop: clip.clippedTop,
          clippedBottom: clip.clippedBottom,
          title: slotTitle(slot),
          active: filter.value.active,
        }))

    // Overlay metadata for a rendered item (proposed pill / removal marker).
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

    // A course belonging to the schedule being edited is draggable.
    const editingId = editingScheduleId
    const { dragOver, dragging, isEditable, onDragStart, zoneOver, zoneLeave, zoneDrop } = useScheduleDrag(
      editingScheduleId,
      moveOffering,
    )

    // The assignable time bands per weekday for the active term are the drop
    // targets. Bands already occupied by a block get their drop handling on the
    // block itself; the rest become empty drop zones.
    const standardTimes = (day) => termSlotOptions(activeTerm.value, day).map((s) => s.time)
    const dropZones = (day) => {
      // In "custom" mode the standard bands are hidden, so their drop zones
      // are hidden too.
      if (blockMode.value === 'custom') return []
      const occupied = new Set(dayBlocks(day).map((b) => b.time))
      return standardTimes(day)
        .filter((time) => !occupied.has(time))
        .map((time) => {
          const [startStr, endStr] = time.split('-')
          const band = { start: toMinutes(startStr), end: toMinutes(endStr) }
          return {
            key: dayGroup(day) + '|' + time,
            day,
            days: dayGroup(day),
            time,
            style: blockStyleFor(band),
          }
        })
    }

    return {
      formatTime,
      shownIndex,
      dayRange,
      blocksInDay,
      onKeyActivate,
      isOpen,
      toggleOpen,
      rowColor,
      filter,
      instructorChip,
      goScheduleSlot,
      goScheduleDay,
      goScheduleCourse,
      dropZones,
      isEditable,
      editingId,
      dragOver,
      dragging,
      dayGroup,
      onDragStart,
      zoneOver,
      zoneLeave,
      zoneDrop,
      openCourseEdit,
      proposalFor,
      removalFor,
      itemTitle,
    }
  },
}
</script>
