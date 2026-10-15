<template>
  <div v-if="groups.otherTimes.length || groups.noMeeting.length" class="no-meeting-strip">
    <div class="no-meeting-columns">
      <section class="no-meeting-group" aria-label="Other times">
        <h3 class="no-meeting-title">
          Other times
          <span class="no-meeting-count">{{ groups.otherTimes.length }}</span>
        </h3>
        <div v-if="groups.otherTimes.length" class="no-meeting-list">
          <div v-for="it in groups.otherTimes" :key="offeringItemKey(it)" class="no-meeting-row">
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
            <span class="no-meeting-pattern">{{ it.o.days }} {{ formatTime(it.o.time) }}</span>
          </div>
        </div>
        <p v-else class="no-meeting-empty">None</p>
      </section>
      <section class="no-meeting-group" aria-label="No meeting time">
        <h3 class="no-meeting-title">
          No meeting time
          <span class="no-meeting-count">{{ groups.noMeeting.length }}</span>
        </h3>
        <div v-if="groups.noMeeting.length" class="no-meeting-list">
          <div v-for="it in groups.noMeeting" :key="offeringItemKey(it)" class="no-meeting-row">
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
          </div>
        </div>
        <p v-else class="no-meeting-empty">None</p>
      </section>
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
  compareItems,
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

// Courses that never appear on the calendar grid for the active term, split
// into two labelled columns: offerings scheduled entirely outside the term's
// rendered hours ("Other times", e.g. a 6pm class in Fall) and offerings with
// no meeting time at all ("No meeting time" — independent studies and the
// like). Both are deliberate, so they live in this strip, draggable onto slots
// in edit mode.
export default {
  name: 'NoMeetingStrip',
  components: { CoursePill },
  props: {
    filter: { type: Object, required: true },
  },
  setup(props) {
    const groups = computed(() => {
      const range = calendarDayRange(activeTerm.value)
      // Dedup and key by the offering's full identity: `code + section` is the
      // same for a lecture and every lab on its letter (labs carry the L in
      // the number and the sequence in the section label, not in those fields),
      // so the plain key would collapse or ghost rows. `offeringItemKey`
      // includes the lab marker, labSeq, content id, and source schedule.
      const keyOf = (it) => offeringItemKey(it)
      const noMeeting = [...(shownSchedule.value.unscheduled || [])]
      const seen = new Set(noMeeting.map(keyOf))
      const otherTimes = []
      for (const d of WEEKDAYS) {
        for (const b of daySlotBlocks(d, shownSchedule.value)) {
          if (clipBand(b, range)) continue
          for (const it of b.items) {
            const key = keyOf(it)
            if (!seen.has(key)) {
              seen.add(key)
              otherTimes.push(it)
            }
          }
        }
      }
      // Both columns read alphabetically by course code (prefix, number,
      // section) — the same order used elsewhere in the app — rather than the
      // loops' incidental day/time order, so the two lists stay consistent.
      otherTimes.sort(compareItems)
      noMeeting.sort(compareItems)
      const matches = (it) => !props.filter.active || props.filter.matches(it)
      return { otherTimes: otherTimes.filter(matches), noMeeting: noMeeting.filter(matches) }
    })
    // Pending-suggestion markers: a proposed pill (dashed) or a removal/move
    // marker (struck through) on a live course a proposal would take away.
    const proposalFor = (it) => overlayProposal(it.o)
    const removalFor = (it) => overlayRemoval(it.o)
    const itemTitle = (it) => overlayTitle(it.o, it.code)
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
      groups,
      proposalFor,
      removalFor,
      itemTitle,
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
