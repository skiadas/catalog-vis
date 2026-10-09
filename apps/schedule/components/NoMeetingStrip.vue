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
      <div v-for="it in items" :key="offeringItemKey(it)" class="no-meeting-row">
        <CoursePill
          :item="it"
          :filter-active="filter.active"
          :color="filter.active ? filter.color(it) : ''"
          :editable="canOpenEditor(it)"
          :draggable="isEditable(it)"
          :drag-day="''"
          :proposed="proposalFor(it) ? itemTitle(it) : ''"
          :removed="removalFor(it) ? itemTitle(it) : ''"
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
import {
  WEEKDAYS,
  daySlotBlocks,
  clipBand,
  calendarDayRange,
  formatTime,
  offeringItemKey,
} from '@major-vis/schedule-core'
import {
  shownSchedule,
  activeTerm,
  editingScheduleId,
  canTouchOffering,
  overlayProposal,
  overlayRemoval,
  overlayTitle,
  openCourseEdit,
} from '../src/scheduleStore.js'
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
      // Dedup and key by the offering's full identity: `code + section` is the
      // same for a lecture and every lab on its letter (labs carry the L in
      // the number and the sequence in the section label, not in those fields),
      // so the plain key would collapse or ghost rows. `offeringItemKey`
      // includes the lab marker, labSeq, content id, and source schedule.
      const keyOf = (it) => offeringItemKey(it)
      const out = [...(shownSchedule.value.unscheduled || [])]
      const seen = new Set(out.map(keyOf))
      for (const d of WEEKDAYS) {
        for (const b of daySlotBlocks(d, shownSchedule.value)) {
          if (clipBand(b, range)) continue
          for (const it of b.items) {
            const key = keyOf(it)
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
    // Pending-suggestion markers: a proposed pill (dashed) or a removal/move
    // marker (struck through) on a live course a proposal would take away.
    const proposalFor = (it) => overlayProposal(it.o)
    const removalFor = (it) => overlayRemoval(it.o)
    const itemTitle = (it) => overlayTitle(it.o, it.code)
    const editMode = computed(() => Boolean(editingScheduleId.value))
    // Per-item editability: the session's own schedule, scoped to the user's
    // departments in a non-owner suggest session.
    const isEditable = (it) =>
      editingScheduleId.value != null && it.sid === editingScheduleId.value && canTouchOffering(it.sid, it.o)
    // The editor also opens for a version the session may only remove (a member
    // of a cross-list group owned elsewhere).
    const canOpenEditor = (it) =>
      editingScheduleId.value != null &&
      it.sid === editingScheduleId.value &&
      (canTouchOffering(it.sid, it.o, 'edit') || canTouchOffering(it.sid, it.o, 'remove'))
    return {
      items,
      proposalFor,
      removalFor,
      itemTitle,
      editMode,
      isEditable,
      canOpenEditor,
      formatTime,
      offeringItemKey,
      activeTerm,
      openCourseEdit,
    }
  },
}
</script>
