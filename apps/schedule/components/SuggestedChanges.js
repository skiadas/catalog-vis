// "Suggested changes" modal for a schedule (remote/backend mode). For a schedule
// this user owns, it lists pending/proposed changes from others with approve /
// reject — applying the diff is handled server-side against its base version.
// For a non-owner it offers proposing the current term's offerings as a change.
//
// Reads the schedule store directly; the caller controls visibility via `open`.

import {
  suggestions,
  refreshSuggestions,
  approveSuggestion,
  rejectSuggestion,
  termOfferings,
  isOwner,
  submitTermSuggestion,
  scheduleById,
} from '../src/scheduleStore.js'
import { renderChanges, TERM_KEYS, TERM_LABELS } from '@major-vis/schedule-core'

const { ref, computed } = Vue

export default {
  name: 'SuggestedChanges',
  props: {
    open: { type: Boolean, default: false },
    scheduleId: { type: [String, Number], default: null },
  },
  emits: ['close'],
  setup(props) {
    const schedule = computed(() => (props.scheduleId ? scheduleById(props.scheduleId) : null))
    const owned = computed(() => isOwner(schedule.value))
    const noteDraft = ref('')
    const proposeFor = ref('F')
    const feedback = ref('')

    const open = async () => {
      feedback.value = ''
      if (props.scheduleId) await refreshSuggestions(props.scheduleId)
    }

    const changeText = (s) => renderChanges(s.operations || [], 'text') || '(no changes)'

    const doApprove = async (id) => {
      const ok = await approveSuggestion(id)
      feedback.value = ok ? 'Approved.' : 'Could not approve (may be stale).'
      if (props.scheduleId) await refreshSuggestions(props.scheduleId)
    }
    const doReject = async (id) => {
      const ok = await rejectSuggestion(id)
      feedback.value = ok ? 'Rejected.' : 'Could not reject.'
      if (props.scheduleId) await refreshSuggestions(props.scheduleId)
    }

    // Non-owner: propose the current term's offerings as a suggested change.
    const doPropose = async () => {
      const s = schedule.value
      if (!s) return
      const term = proposeFor.value
      const offerings = termOfferings(s, term)
      const created = await submitTermSuggestion(s.id, term, offerings, noteDraft.value)
      feedback.value = created ? `Proposed ${TERM_LABELS[term]} changes.` : 'Nothing to propose (no changes).'
      noteDraft.value = ''
      if (props.scheduleId) await refreshSuggestions(props.scheduleId)
    }

    const exportUrl = computed(() =>
      props.scheduleId
        ? `../../api/schedules/${encodeURIComponent(props.scheduleId)}/suggestions/export?fmt=md`
        : '',
    )

    return {
      schedule,
      owned,
      suggestions,
      noteDraft,
      proposeFor,
      feedback,
      TERM_KEYS,
      TERM_LABELS,
      open,
      changeText,
      doApprove,
      doReject,
      doPropose,
      exportUrl,
    }
  },
  template: `
    <div v-if="open" class="modal-overlay" @click.self="$emit('close')" @keydown.esc="$emit('close')">
      <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="suggested-title">
        <div class="modal-head">
          <h3 id="suggested-title">Suggested changes — {{ schedule && schedule.name }}</h3>
          <button class="modal-close" @click="$emit('close')" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p v-if="feedback" class="suggested-feedback">{{ feedback }}</p>

          <template v-if="owned">
            <p class="modal-intro">
              People change your schedule by proposing diff changes; you approve or reject each one.
            </p>
            <div v-if="!suggestions.length" class="schedule-manage-empty">No suggestions yet.</div>
            <div v-else class="suggested-list">
              <div v-for="s in suggestions" :key="s.id" class="suggested-row" :class="s.status">
                <div class="suggested-main">
                  <div class="suggested-head">
                    <span class="suggested-pill">{{ TERM_LABELS[s.term] || s.term }}</span>
                    <span class="suggested-who">#{{ s.id }} · {{ s.proposer }}</span>
                    <span class="suggested-status">{{ s.status }}</span>
                  </div>
                  <div class="suggested-change">{{ changeText(s) }}</div>
                  <div v-if="s.note" class="suggested-note">{{ s.note }}</div>
                </div>
                <div v-if="s.status === 'pending'" class="suggested-actions">
                  <button class="filter-btn" @click="doApprove(s.id)">Approve</button>
                  <button class="filter-btn" @click="doReject(s.id)">Reject</button>
                </div>
              </div>
            </div>
            <a v-if="suggestions.length" class="filter-btn" :href="exportUrl" target="_blank" rel="noopener">Export (markdown)</a>
          </template>

          <template v-else>
            <p class="modal-intro">
              You don't own this schedule, so changes are proposed as a diff for the owner to approve.
            </p>
            <div class="field">
              <label>Term to propose changes for</label>
              <select class="search-input" v-model="proposeFor">
                <option v-for="t in TERM_KEYS" :key="t" :value="t">{{ TERM_LABELS[t] }}</option>
              </select>
            </div>
            <div class="field">
              <label for="suggested-note">Note (optional)</label>
              <input id="suggested-note" class="search-input" type="text" v-model="noteDraft" placeholder="e.g. suggested by the math department" />
            </div>
            <div class="controls">
              <span class="controls-spacer"></span>
              <button class="filter-btn" @click="$emit('close')">Close</button>
              <button class="filter-btn primary" @click="doPropose">Propose changes</button>
            </div>
          </template>
        </div>
      </div>
    </div>
  `,
}
