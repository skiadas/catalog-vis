<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="$emit('close')" @keydown.esc="$emit('close')">
    <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div class="modal-head">
        <h3 id="history-title">History — {{ nameLabel }}</h3>
        <button class="modal-close" @click="$emit('close')" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p class="modal-intro">
          Every change made in this session, newest first. Undo steps back through them one at a time;
          <em>Undo to here</em> rewinds everything after that change (the undone steps stay replayable with
          Redo). Changes made before this session aren't listed.
        </p>

        <div v-if="!entries.length" class="schedule-manage-empty">No changes yet this session.</div>
        <div v-else class="history-list">
          <div v-for="e in entries" :key="e.key" class="history-row" :class="{ undone: e.undone }">
            <span class="history-label">{{ e.label }}</span>
            <span v-if="e.undone" class="history-undone">(undone)</span>
            <button
              v-else
              class="filter-btn history-undo-btn"
              @click="undoThrough(e.stackIndex)"
              :title="'Rewind to before this change' + shortcutHint"
            >
              Undo to here
            </button>
          </div>
        </div>

        <div class="controls history-controls">
          <span class="controls-spacer"></span>
          <button class="filter-btn" :disabled="!canRedo" @click="redo">Redo</button>
          <button class="filter-btn" :disabled="!canUndo" @click="undoAll">Undo all</button>
          <button class="filter-btn primary" :disabled="!canUndo" @click="undo">
            Undo{{ canUndo ? ' (⌘Z)' : '' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// "What happened in this session" panel with per-change undo. Mirror of the
// suggested-changes modal in structure; state all comes from the schedule
// store's per-session history stacks.
import {
  historyEntries,
  canUndo,
  canRedo,
  undo,
  redo,
  undoAll,
  undoThrough,
  editingSchedule,
  activeTerm,
} from '../src/scheduleStore.js'
import { TERM_LABELS } from '@major-vis/schedule-core'

import { computed } from 'vue'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export default {
  name: 'ScheduleHistory',
  props: {
    isOpen: { type: Boolean, default: false },
  },
  emits: ['close'],
  setup(props) {
    const entries = computed(() => (props.isOpen ? historyEntries.value : []))
    const nameLabel = computed(() => {
      const s = editingSchedule.value
      return s ? `${s.name} · ${TERM_LABELS[activeTerm.value] || activeTerm.value}` : ''
    })
    const shortcutHint = isMac ? ' (⌘Z)' : ' (Ctrl+Z)'
    return {
      entries,
      nameLabel,
      shortcutHint,
      canUndo,
      canRedo,
      undo,
      redo,
      undoAll,
      undoThrough,
    }
  },
}
</script>
