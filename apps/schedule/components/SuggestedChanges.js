// "Suggested changes" panel for a schedule. The live (pending) suggestions of
// every proposer are visible to everyone — that's the coordination surface
// (a CS change from a non-CS person is reviewable by the owner). History is
// visible to the owner and to the row's own proposer.
//
// While a suggest session is active on this schedule, the panel leads with the
// draft's diff preview and a one-click propose (upserting the proposer's own
// pending suggestion). Suggestion review is per change: the owner approves or
// rejects each operation of a pending row individually (each op carries its own
// resolution marker; the row stays pending until every op is resolved, then
// finalizes to 'approved'/'moot'/'rejected'). A pending row's proposer can
// withdraw it, even while the owner is mid-review.

import {
  suggestions,
  refreshSuggestions,
  resolveOp,
  withdrawSuggestion,
  proposeDraft,
  draftOperations,
  isOwner,
  isSuggestSessionFor,
  scheduleById,
  currentUser,
  remote,
  activeTerm,
} from '../src/scheduleStore.js'
import { TERM_LABELS } from '@major-vis/schedule-core'
import { renderChanges, describeChange, opResolution } from '@major-vis/schedule-core/diff'

import { ref, computed, watch } from 'vue'

export default {
  name: 'SuggestedChanges',
  props: {
    isOpen: { type: Boolean, default: false },
    scheduleId: { type: [String, Number], default: null },
  },
  emits: ['close'],
  setup(props) {
    const schedule = computed(() => (props.scheduleId ? scheduleById(props.scheduleId) : null))
    const owned = computed(() => isOwner(schedule.value))
    const suggesting = computed(() => isSuggestSessionFor(props.scheduleId))
    const noteDraft = ref('')
    const feedback = ref('')

    // Whether the current user proposed a suggestion row (offline: everything
    // in the local trail is theirs).
    const isMine = (s) =>
      !remote.value ||
      (currentUser.value != null && Number(s.proposer_user_id) === Number(currentUser.value.id))

    // The draft's pending diff for the active term (what proposing would send).
    const draftOps = computed(() =>
      props.scheduleId ? draftOperations(props.scheduleId, activeTerm.value) : [],
    )
    const draftText = computed(() => renderChanges(draftOps.value, 'text') || '(no changes yet)')

    // Refresh suggestions each time the modal opens.
    const load = async () => {
      feedback.value = ''
      if (props.scheduleId) await refreshSuggestions(props.scheduleId)
    }
    watch(
      () => props.isOpen,
      (isOpenNow) => {
        if (isOpenNow) load()
      },
    )

    const opStatus = (op) => opResolution(op)

    // The row status pill: final states verbatim; a live row under review shows
    // how much of it is settled ("pending · accepted 1 of 3").
    const rowLabel = (s) => {
      const ops = s.operations || []
      const settled = ops.filter((op) => opResolution(op) !== 'pending').length
      if (s.status === 'pending' && settled > 0) {
        const accepted = ops.filter((op) => opResolution(op) === 'accepted').length
        return `${s.status} · ${accepted} of ${ops.length} accepted`
      }
      return s.status
    }

    // Resolved without per-op buttons: the change text carries markers.
    const changeText = (s) =>
      (s.operations || [])
        .map((op) => {
          const label = opResolution(op)
          const text = describeChange(op)
          return label === 'pending' ? text : `${text} [${label}]`
        })
        .join('\n') || '(no changes)'

    const doApproveOp = async (id, index) => {
      const saved = await resolveOp(id, index, 'accepted')
      feedback.value = saved ? 'Change approved.' : 'Could not approve (it may no longer be pending).'
      if (props.scheduleId) await refreshSuggestions(props.scheduleId)
    }
    const doRejectOp = async (id, index) => {
      const saved = await resolveOp(id, index, 'rejected')
      feedback.value = saved ? 'Change rejected.' : 'Could not reject.'
      if (props.scheduleId) await refreshSuggestions(props.scheduleId)
    }
    const doWithdraw = async (id) => {
      const ok = await withdrawSuggestion(id)
      feedback.value = ok ? 'Withdrawn — kept in the trail.' : 'Could not withdraw.'
      if (props.scheduleId) await refreshSuggestions(props.scheduleId)
    }

    // Non-owner/suggestor: propose the active term's draft as a suggestion.
    const doPropose = async () => {
      if (!props.scheduleId) return
      const created = await proposeDraft(props.scheduleId, noteDraft.value)
      feedback.value = created
        ? `Proposed ${TERM_LABELS[activeTerm.value]} changes.`
        : 'Nothing new to propose (no changes since the last proposal).'
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
      suggesting,
      suggestions,
      noteDraft,
      feedback,
      draftText,
      draftOps,
      changeText,
      opStatus,
      rowLabel,
      isMine,
      doApproveOp,
      doRejectOp,
      doWithdraw,
      doPropose,
      exportUrl,
      TERM_LABELS,
      activeTerm,
    }
  },
  template: `
    <div v-if="isOpen" class="modal-overlay" @click.self="$emit('close')" @keydown.esc="$emit('close')">
      <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="suggested-title">
        <div class="modal-head">
          <h3 id="suggested-title">Suggested changes — {{ schedule && schedule.name }}</h3>
          <button class="modal-close" @click="$emit('close')" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p v-if="feedback" class="suggested-feedback">{{ feedback }}</p>

          <div v-if="suggesting" class="field">
            <label>Your proposal for {{ TERM_LABELS[activeTerm] }} ({{ schedule && schedule.name }})</label>
            <p class="modal-intro">
              These are the changes you have collected in this session. Nothing is written to the schedule until you propose them and the owner approves.
            </p>
            <div class="suggested-draft-preview">{{ draftText }}</div>
            <div class="field">
              <label for="suggested-note">Note (optional)</label>
              <input id="suggested-note" class="search-input" type="text" v-model="noteDraft" placeholder="e.g. suggested by the physics department" />
            </div>
            <div class="controls">
              <span class="controls-spacer"></span>
              <button class="filter-btn" @click="$emit('close')">Close</button>
              <button
                class="filter-btn primary"
                :disabled="!draftOps.length"
                @click="doPropose"
              >{{ draftOps.length ? 'Propose changes' : 'Nothing to propose yet' }}</button>
            </div>
          </div>

          <p class="modal-intro" v-else>
            {{ owned
              ? 'Pending changes from the departments are live: approve or reject each change individually; the trail keeps everything that happened.'
              : "You don't own this schedule. Proposals here are suggestions for the owner — make your changes via 'Suggest changes'." }}
          </p>

          <div v-if="!suggestions.length" class="schedule-manage-empty">No suggestions yet.</div>
          <div v-else class="suggested-list">
            <div v-for="s in suggestions" :key="s.id" class="suggested-row" :class="s.status">
              <div class="suggested-main">
                <div class="suggested-head">
                  <span class="suggested-pill">{{ TERM_LABELS[s.term] || s.term }}</span>
                  <span class="suggested-who">#{{ s.id }} · {{ s.proposer }}{{ isMine(s) ? ' (yours)' : '' }}</span>
                  <span class="suggested-status">{{ rowLabel(s) }}</span>
                </div>
                <div v-if="owned && s.status === 'pending'" class="suggested-ops">
                  <div
                    v-for="(op, i) in s.operations"
                    :key="i"
                    class="suggested-op"
                    :class="'op-' + opStatus(op)"
                  >
                    <span class="suggested-op-text">{{ describeChange(op) || '(empty change)' }}</span>
                    <span v-if="opStatus(op) !== 'pending'" class="suggested-op-status">{{ opStatus(op) }}</span>
                    <span v-else class="suggested-op-actions">
                      <button class="filter-btn" @click="doApproveOp(s.id, i)">Approve</button>
                      <button class="filter-btn" @click="doRejectOp(s.id, i)">Reject</button>
                    </span>
                  </div>
                </div>
                <div v-else class="suggested-change">{{ changeText(s) }}</div>
                <div v-if="s.note" class="suggested-note">{{ s.note }}</div>
              </div>
              <div v-if="s.status === 'pending' && isMine(s) && !owned" class="suggested-actions">
                <button class="filter-btn" @click="doWithdraw(s.id)">Withdraw</button>
              </div>
            </div>
          </div>
          <a v-if="remote && owned && suggestions.length" class="filter-btn" :href="exportUrl" target="_blank" rel="noopener">Export (markdown)</a>
        </div>
      </div>
    </div>
  `,
}
