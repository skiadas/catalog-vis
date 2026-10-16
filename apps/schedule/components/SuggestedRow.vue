<template>
  <div class="suggested-row" :class="s.status">
    <div class="suggested-main">
      <div class="suggested-head">
        <span class="suggested-pill">{{ TERM_LABELS[s.term] || s.term }}</span>
        <span class="suggested-who"
          >#{{ s.id }} · {{ displayName(s.proposer) }}{{ mine ? ' (yours)' : '' }}</span
        >
        <span class="suggested-status">{{ rowLabel(s) }}</span>
      </div>
      <div v-if="(owned || mine) && s.status === 'pending'" class="suggested-ops">
        <div v-for="e in s.operations" :key="e.id" class="suggested-op" :class="'op-' + opStatus(e)">
          <span class="suggested-op-text">{{ opLabel(s, e) || '(empty change)' }}</span>
          <span v-if="opStatus(e) !== 'pending'" class="suggested-op-status">{{ opStatus(e) }}</span>
          <span v-else class="suggested-op-actions">
            <template v-if="owned">
              <button class="filter-btn" @click="$emit('approve', s.id, e.id)">Approve</button>
              <button class="filter-btn" @click="$emit('reject', s.id, e.id)">Reject</button>
            </template>
            <template v-else-if="mine">
              <button class="filter-btn" @click="$emit('withdraw', s.id, e.id)">Withdraw</button>
            </template>
          </span>
        </div>
      </div>
      <div v-else class="suggested-change">{{ changeText(s) }}</div>
      <div v-if="s.note" class="suggested-note">{{ s.note }}</div>
    </div>
    <div v-if="s.status === 'pending' && mine && !owned" class="suggested-actions">
      <button class="filter-btn" :disabled="!hasPending(s)" @click="$emit('withdraw-all', s.id)">
        Withdraw all
      </button>
    </div>
  </div>
</template>

<script>
// One suggestion row: the term/proposer/status head, the per-operation
// approve/reject (owner) or withdraw (proposer) controls, or the resolved
// read-only change text. Extracted so the suggestions panel can render the
// same row in its own-proposals list, the collapsed "other changes"
// disclosure, and the owner's flat review list.

import { TERM_LABELS } from '@major-vis/schedule-core'
import { describeChange, opGroupKey } from '@major-vis/schedule-core/diff'
import { splitGroupsFor } from '../src/scheduleStore.js'
import { displayName } from '../src/names.js'

import { computed } from 'vue'

export default {
  name: 'SuggestedRow',
  props: {
    s: { type: Object, required: true },
    // Whether the viewer owns the schedule (approve/reject) …
    owned: { type: Boolean, default: false },
    // … and whether the row is the viewer's own proposal (withdraw).
    mine: { type: Boolean, default: false },
    // The schedule the row belongs to, for the split-meeting label resolution.
    scheduleId: { type: [String, Number], default: null },
  },
  emits: ['approve', 'reject', 'withdraw', 'withdraw-all'],
  setup(props) {
    const opStatus = (e) => (e && e.resolution && e.resolution.status) || 'pending'
    const hasPending = (s) => (s.operations || []).some((e) => opStatus(e) === 'pending')

    // A meeting is named only when the section is split (the split set comes
    // from the schedule's published term plus the row's own ops).
    const splitGroups = computed(() => splitGroupsFor(props.s.operations || [], props.scheduleId))
    const opLabel = (s, e) => describeChange(e.op, { showMeeting: splitGroups.value.has(opGroupKey(e.op)) })

    // The row status pill: final states verbatim; a live row under review shows
    // how much of it is settled ("pending · accepted 1 of 3").
    const rowLabel = (s) => {
      const ops = s.operations || []
      const settled = ops.filter((e) => opStatus(e) !== 'pending').length
      if (s.status === 'pending' && settled > 0) {
        const accepted = ops.filter((e) => opStatus(e) === 'accepted').length
        return `${s.status} · ${accepted} of ${ops.length} accepted`
      }
      return s.status
    }

    // Resolved without per-op buttons: the change text carries markers.
    const changeText = (s) =>
      (s.operations || [])
        .map((e) => {
          const label = opStatus(e)
          const text = opLabel(s, e)
          return label === 'pending' ? text : `${text} [${label}]`
        })
        .join('\n') || '(no changes)'

    return { TERM_LABELS, displayName, opStatus, hasPending, opLabel, rowLabel, changeText }
  },
}
</script>
