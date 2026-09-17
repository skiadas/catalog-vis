<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="$emit('close')">
    <div
      ref="modalEl"
      class="modal modal-wide"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-title"
    >
      <div class="modal-head">
        <h3 id="history-title">History — {{ nameLabel }}</h3>
        <button class="modal-close" @click="$emit('close')" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p v-if="feedback" class="suggested-feedback" role="status">{{ feedback }}</p>
        <p class="modal-intro">
          This session's changes, compared with where the term started: one row per course, so moving a course
          twice nets to one change (moving it back removes it from the list entirely). <em>Cancel</em> undoes
          just that one change; the rest of the session stays put. Cancelled changes stay listed and can be
          restored.
        </p>

        <div v-if="!entries.length" class="schedule-manage-empty">No changes yet this session.</div>
        <div v-else class="history-list">
          <div v-for="e in entries" :key="e.key" class="history-row" :class="{ cancelled: e.cancelled }">
            <div class="history-main">
              <span class="history-label">{{ e.label }}</span>
              <span v-if="e.cancelled" class="history-undone">(cancelled)</span>
            </div>
            <span v-if="e.cancelled" class="history-op-actions">
              <button class="filter-btn" @click="doRestore(e)">Restore</button>
              <button v-if="e.editable" class="filter-btn" @click="doEdit(e)">Edit</button>
            </span>
            <span v-else class="history-op-actions">
              <button class="filter-btn" title="Undo just this change" @click="doCancel(e)">Cancel</button>
              <button
                v-if="e.editable"
                class="filter-btn"
                title="Open this course in the editor"
                @click="doEdit(e)"
              >
                Edit
              </button>
            </span>
          </div>
        </div>

        <div class="controls history-controls">
          <span class="controls-spacer"></span>
          <button class="filter-btn" :disabled="!canCancel" @click="doCancelAll">Cancel all</button>
          <button class="filter-btn" :disabled="!canCancel" @click="doCancelLatest">
            Cancel latest{{ canCancel ? ' (⌘Z)' : '' }}
          </button>
          <button class="filter-btn primary" @click="$emit('close')">OK</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// "What happened in this session" panel. A net-diff change list, one row per
// touched course: Cancel drops that single change out of the session (the row
// flips to cancelled, restorable); Edit jumps into the course editor on that
// course. Row content and state all come from the schedule store's per-session
// change list, which reuses the suggestion diff machinery.
import {
  historyEntries,
  canCancel,
  cancelChange,
  cancelLatest,
  cancelAll,
  restoreChange,
  editingSchedule,
  activeTerm,
} from '../src/scheduleStore.js'
import { TERM_LABELS } from '@major-vis/schedule-core'
import { useModalFocus } from '../src/modalFocus.js'

import { computed, ref } from 'vue'

export default {
  name: 'ScheduleHistory',
  props: {
    isOpen: { type: Boolean, default: false },
  },
  emits: ['close', 'edit-course'],
  setup(props, { emit }) {
    const modalEl = ref(null)
    const close = () => emit('close')
    useModalFocus(() => props.isOpen, modalEl, close)
    const entries = computed(() => (props.isOpen ? historyEntries.value : []))
    const nameLabel = computed(() => {
      const s = editingSchedule.value
      return s ? `${s.name} · ${TERM_LABELS[activeTerm.value] || activeTerm.value}` : ''
    })
    const feedback = ref('')
    const doCancel = (e) => {
      feedback.value = cancelChange(e.key) ? 'Change cancelled.' : 'Nothing to cancel.'
    }
    const doRestore = (e) => {
      feedback.value = restoreChange(e.key) ? 'Change restored.' : 'Nothing to restore.'
    }
    const doCancelAll = () => {
      feedback.value = cancelAll() ? 'All changes cancelled — kept as cancelled rows.' : 'Nothing to cancel.'
    }
    const doCancelLatest = () => {
      feedback.value = cancelLatest() ? 'Latest change cancelled.' : 'Nothing to cancel.'
    }
    const doEdit = (e) => emit('edit-course', e.op)
    return {
      entries,
      modalEl,
      nameLabel,
      feedback,
      canCancel,
      doCancel,
      doRestore,
      doCancelAll,
      doCancelLatest,
      doEdit,
    }
  },
}
</script>
