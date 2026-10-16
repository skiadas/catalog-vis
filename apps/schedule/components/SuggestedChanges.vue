<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div
      ref="modalEl"
      class="modal modal-wide"
      :class="{ 'modal-editor': suggesting }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="suggested-title"
    >
      <div class="modal-head">
        <h3 id="suggested-title">
          {{ suggesting ? 'Propose changes' : 'Suggested changes' }} — {{ schedule && schedule.name }}
        </h3>
        <button class="modal-close" @click="$emit('close')" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p v-if="feedback" class="suggested-feedback" role="status">{{ feedback }}</p>

        <template v-if="suggesting">
          <div class="field">
            <span class="field-label"
              >Your proposal for {{ TERM_LABELS[activeTerm] }} ({{ schedule && schedule.name }})</span
            >
            <p class="modal-intro">
              These are the changes you have collected in this session. Nothing is written to the schedule
              until you propose them and the owner approves.
            </p>
            <p v-if="!owned && !myDepartments.length" class="suggested-feedback" role="status">
              Your account has no departments yet — suggestions are limited to your departments, so ask an
              admin to add them before proposing.
            </p>
            <div class="suggested-draft-preview">{{ draftText }}</div>
            <div class="field">
              <label for="suggested-note">Note (optional)</label>
              <input
                id="suggested-note"
                class="search-input"
                type="text"
                v-model="noteDraft"
                placeholder="e.g. suggested by the physics department"
              />
            </div>
          </div>

          <!-- The proposer's own already-sent suggestions stay in view (so they
               can still withdraw), while everyone else's collapse behind a
               disclosure so the draft + send action lead the dialog. -->
          <div v-if="mineSuggestions.length" class="suggested-mine">
            <span class="field-label">Already proposed</span>
            <div class="suggested-list">
              <SuggestedRow
                v-for="s in mineSuggestions"
                :key="s.id"
                :s="s"
                :owned="owned"
                :mine="true"
                :schedule-id="scheduleId"
                @approve="doApproveOp"
                @reject="doRejectOp"
                @withdraw="doWithdrawOp"
                @withdraw-all="doWithdrawAll"
              />
            </div>
          </div>
          <details v-if="otherSuggestions.length" class="suggested-others">
            <summary>Other pending changes ({{ otherSuggestions.length }})</summary>
            <div class="suggested-list">
              <SuggestedRow
                v-for="s in otherSuggestions"
                :key="s.id"
                :s="s"
                :owned="owned"
                :mine="false"
                :schedule-id="scheduleId"
                @approve="doApproveOp"
                @reject="doRejectOp"
                @withdraw="doWithdrawOp"
                @withdraw-all="doWithdrawAll"
              />
            </div>
          </details>
          <div v-if="!suggestions.length" class="schedule-manage-empty">No suggestions yet.</div>
        </template>

        <template v-else>
          <p class="modal-intro">
            {{
              owned
                ? 'Pending changes from the departments are live: approve or reject each change individually; the trail keeps everything that happened.'
                : canSuggestFor
                  ? `You don't own this schedule${ownerName ? ` (${displayName(ownerName)} does)` : ''}. Proposals here are suggestions for the owner — make your changes via 'Suggest changes'.`
                  : `You can view this schedule${ownerName ? ` (${displayName(ownerName)} owns it)` : ''}, but you aren't listed as a suggester — ask the owner to add you if you need to propose changes.`
            }}
          </p>

          <div v-if="!suggestions.length" class="schedule-manage-empty">No suggestions yet.</div>
          <div v-else class="suggested-list">
            <SuggestedRow
              v-for="s in suggestions"
              :key="s.id"
              :s="s"
              :owned="owned"
              :mine="isMine(s)"
              :schedule-id="scheduleId"
              @approve="doApproveOp"
              @reject="doRejectOp"
              @withdraw="doWithdrawOp"
              @withdraw-all="doWithdrawAll"
            />
          </div>
          <a
            v-if="remote && owned && suggestions.length"
            class="filter-btn"
            :href="exportUrl"
            target="_blank"
            rel="noopener"
            >Export (markdown)</a
          >
        </template>
      </div>

      <!-- The send action is pinned: however long the schedule's change list
           is, the proposer can always reach it. -->
      <div v-if="suggesting" class="modal-foot">
        <span class="controls-spacer"></span>
        <button class="filter-btn" @click="$emit('close')">Close</button>
        <button class="filter-btn primary" :disabled="!canPropose" @click="doPropose">
          {{ proposeLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
// Suggestions panel for a schedule. The live (pending) suggestions of every
// proposer are visible to everyone — that's the coordination surface (a CS
// change from a non-CS person is reviewable by the owner).
//
// While a suggest session is active on this schedule the panel becomes the
// focused "Propose changes" step: the draft's diff preview, a note field, and
// a pinned send action lead, the proposer's own already-proposed suggestions
// stay in view (withdrawable), and every other proposer's suggestions collapse
// behind a disclosure so they don't bury the action. Without a session it is
// the review surface: the flat list of every suggestion, each operation
// first-class (its own id + resolution: pending/accepted/rejected/withdrawn),
// which the owner approves or rejects individually.

import {
  suggestions,
  refreshSuggestions,
  resolveOp,
  withdrawSuggestion,
  proposeDraft,
  draftUnsentOperations,
  isOwner,
  canSuggest,
  isSuggestSessionFor,
  scheduleById,
  currentUser,
  myDepartments,
  remote,
  activeTerm,
  splitGroupsFor,
} from '../src/scheduleStore.js'
import { TERM_LABELS } from '@major-vis/schedule-core'
import { renderChanges } from '@major-vis/schedule-core/diff'
import { useModalFocus } from '../src/modalFocus.js'
import { displayName } from '../src/names.js'
import SuggestedRow from './SuggestedRow.vue'

import { ref, computed, watch } from 'vue'

export default {
  name: 'SuggestedChanges',
  components: { SuggestedRow },
  props: {
    scheduleId: { type: [String, Number], default: null },
  },
  emits: ['close', 'sent'],
  setup(props, { emit }) {
    // The overlay only exists while its route is active, so the trap is always
    // on for its lifetime (the caller gates it with `v-if`).
    const modalEl = ref(null)
    useModalFocus(ref(true), modalEl, () => emit('close'))
    const schedule = computed(() => (props.scheduleId ? scheduleById(props.scheduleId) : null))
    const owned = computed(() => isOwner(schedule.value))
    const canSuggestFor = computed(() => canSuggest(schedule.value))
    const ownerName = computed(() => (schedule.value && schedule.value.owner) || '')
    const suggesting = computed(() => isSuggestSessionFor(props.scheduleId))
    const noteDraft = ref('')
    const feedback = ref('')

    // Whether the current user proposed a suggestion row (offline: everything
    // in the local trail is theirs).
    const isMine = (s) =>
      !remote.value ||
      (currentUser.value != null && Number(s.proposer_user_id) === Number(currentUser.value.id))

    // While composing, the row lists split by ownership: your own stay visible,
    // everyone else's collapse. In the review view the flat list is used.
    const mineSuggestions = computed(() => suggestions.value.filter((s) => isMine(s)))
    const otherSuggestions = computed(() => suggestions.value.filter((s) => !isMine(s)))

    // The changes made since the session began (or the last proposal) — the new
    // work this session is collecting. The already-proposed ops are not repeated
    // here; they show above, where they can be withdrawn.
    const draftOps = computed(() =>
      props.scheduleId ? draftUnsentOperations(props.scheduleId, activeTerm.value) : [],
    )
    const draftText = computed(
      () =>
        renderChanges(draftOps.value, 'text', {
          splitGroups: splitGroupsFor(draftOps.value, props.scheduleId),
        }) || '(no changes yet)',
    )

    const canPropose = computed(() => draftOps.value.length > 0)
    const proposeLabel = computed(() => (canPropose.value ? 'Propose changes' : 'Nothing new to propose'))

    // Refresh suggestions on mount and whenever the panel's schedule changes.
    const load = async () => {
      feedback.value = ''
      if (props.scheduleId) await refreshSuggestions(props.scheduleId)
    }
    watch(() => props.scheduleId, load, { immediate: true })

    const doApproveOp = async (id, opId) => {
      const saved = await resolveOp(id, opId, 'accepted')
      feedback.value = saved ? 'Change approved.' : 'Could not approve (it may no longer be pending).'
      if (props.scheduleId) await refreshSuggestions(props.scheduleId)
    }
    const doRejectOp = async (id, opId) => {
      const saved = await resolveOp(id, opId, 'rejected')
      feedback.value = saved ? 'Change rejected.' : 'Could not reject.'
      if (props.scheduleId) await refreshSuggestions(props.scheduleId)
    }
    const doWithdrawOp = async (id, opId) => {
      const saved = await withdrawSuggestion(id, opId)
      feedback.value = saved ? 'Change withdrawn — kept in the trail.' : 'Could not withdraw.'
      if (props.scheduleId) await refreshSuggestions(props.scheduleId)
    }
    const doWithdrawAll = async (id) => {
      const saved = await withdrawSuggestion(id)
      feedback.value = saved ? 'Remaining changes withdrawn — kept in the trail.' : 'Could not withdraw.'
      if (props.scheduleId) await refreshSuggestions(props.scheduleId)
    }

    // Non-owner/suggestor: propose the active term's draft as a suggestion. A
    // successful send is finished by the parent (it owns the session + flash);
    // refusals and no-ops leave the session and draft in place for fixing.
    const doPropose = async () => {
      if (!props.scheduleId) return
      const created = await proposeDraft(props.scheduleId, noteDraft.value)
      if (created && created.error) {
        feedback.value =
          created.error === 'dept_restricted'
            ? `Not proposed: you can only suggest changes in your departments (blocked: ${created.codes || 'some courses'}).`
            : 'Could not propose — please try again.'
        return
      }
      if (!created) {
        feedback.value = 'Nothing new to propose (no changes since the last proposal).'
        return
      }
      noteDraft.value = ''
      emit('sent', activeTerm.value)
    }

    const exportUrl = computed(() =>
      props.scheduleId
        ? `../../api/schedules/${encodeURIComponent(props.scheduleId)}/suggestions/export?fmt=md`
        : '',
    )

    return {
      schedule,
      modalEl,
      owned,
      canSuggestFor,
      ownerName,
      suggesting,
      suggestions,
      mineSuggestions,
      otherSuggestions,
      noteDraft,
      feedback,
      draftText,
      draftOps,
      canPropose,
      proposeLabel,
      displayName,
      isMine,
      myDepartments,
      doApproveOp,
      doRejectOp,
      doWithdrawOp,
      doWithdrawAll,
      doPropose,
      exportUrl,
      TERM_LABELS,
      activeTerm,
      remote,
    }
  },
}
</script>
