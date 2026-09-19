<template>
  <div class="modal-overlay" @click.self="close">
    <div ref="modalEl" class="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-access-title">
      <div class="modal-head">
        <h3 id="schedule-access-title">Access — {{ schedule ? schedule.name : '' }}</h3>
        <button class="modal-close" @click="close" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <template v-if="owned">
          <p v-if="feedback" class="suggested-feedback" role="status">{{ feedback }}</p>
          <div class="field">
            <label for="access-visibility">Who can see this schedule?</label>
            <select id="access-visibility" class="search-input" v-model="visibility">
              <option value="private">Only you</option>
              <option value="shared">Listed users</option>
              <option value="public">Everyone</option>
            </select>
          </div>
          <div v-if="visibility === 'shared'" class="field">
            <span class="field-label">Viewers</span>
            <div v-if="viewers.length" class="access-list">
              <div v-for="u in viewers" :key="u" class="access-list-row">
                <span>{{ displayName(u) }}</span>
                <button
                  class="access-list-remove"
                  :aria-label="'Remove ' + displayName(u)"
                  title="Remove"
                  @click="viewers.splice(viewers.indexOf(u), 1)"
                >
                  ×
                </button>
              </div>
            </div>
            <div v-else class="access-list-empty">No viewers yet — the schedule stays private to you.</div>
            <div class="access-add">
              <input
                class="search-input"
                type="text"
                placeholder="username"
                aria-label="Add viewer"
                list="access-user-names"
                v-model="viewerDraft"
                @keydown.enter.prevent="addViewer"
              />
              <button class="filter-btn" :disabled="!viewerDraft.trim()" @click="addViewer">Add</button>
            </div>
          </div>
          <div class="field">
            <label for="access-suggest">Who can suggest changes?</label>
            <select id="access-suggest" class="search-input" v-model="suggestMode">
              <option value="owner">Only you</option>
              <option value="shared">Listed users</option>
              <option value="public">Everyone</option>
            </select>
          </div>
          <div v-if="suggestMode === 'shared'" class="field">
            <span class="field-label">Suggesters</span>
            <div v-if="suggesters.length" class="access-list">
              <div v-for="u in suggesters" :key="u" class="access-list-row">
                <span>{{ displayName(u) }}</span>
                <button
                  class="access-list-remove"
                  :aria-label="'Remove ' + displayName(u)"
                  title="Remove"
                  @click="suggesters.splice(suggesters.indexOf(u), 1)"
                >
                  ×
                </button>
              </div>
            </div>
            <div v-else class="access-list-empty">No suggesters yet — only you can propose changes.</div>
            <div class="access-add">
              <input
                class="search-input"
                type="text"
                placeholder="username"
                aria-label="Add suggester"
                list="access-user-names"
                v-model="suggesterDraft"
                @keydown.enter.prevent="addSuggester"
              />
              <button class="filter-btn" :disabled="!suggesterDraft.trim()" @click="addSuggester">Add</button>
            </div>
          </div>
          <datalist id="access-user-names">
            <option v-for="u in nameSuggestions" :key="u.username" :value="u.username">
              {{ displayName(u.displayName || u.username) }}
            </option>
          </datalist>
          <p class="modal-intro">
            A listed suggester can always see the schedule too. Everyone signed in can see and propose on
            public schedules.
          </p>
          <div class="controls">
            <span class="controls-spacer"></span>
            <button class="filter-btn" @click="close">Cancel</button>
            <button class="filter-btn primary" :disabled="saving" @click="saveAccess">
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </template>
        <template v-else>
          <p class="modal-intro schedule-access-denied">
            Only the owner can change access for this schedule.
          </p>
          <div class="controls">
            <span class="controls-spacer"></span>
            <button class="filter-btn" @click="close">Close</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
// Owner-only access dialog, reached as the overlay route
// `#/schedule/<id>/access` (rendered by the ScheduleApp shell over whatever
// surface was underneath). Edits local copies of the visibility/suggest mode
// and the viewer/suggester lists and saves once; the server canonicalizes the
// lists and the response replaces the row, so the UI echoes stored truth.
// Non-owners (and missing schedules) get a denial state — normally unreachable
// (the manage row's Access button is owner-only), but a deep link or bookmark
// must not present a form that cannot save.

import { schedules, isOwner, updateScheduleAccess } from '../src/scheduleStore.js'
import { useModalFocus } from '../src/modalFocus.js'
import { displayName } from '../src/names.js'
import * as backend from '../src/backend.js'

import { ref, computed, watch } from 'vue'

export default {
  name: 'ScheduleAccess',
  props: {
    scheduleId: { type: String, required: true },
  },
  emits: ['close'],
  setup(props, { emit }) {
    // The overlay only exists while the route is active, so its focus trap is
    // always on for its lifetime (same as the course editor).
    const modalEl = ref(null)
    const close = () => emit('close')
    useModalFocus(ref(true), modalEl, close)

    // Route params are strings; remote schedule ids are numbers. Match loosely
    // so both resolve.
    const schedule = computed(
      () => schedules.value.find((s) => String(s.id) === String(props.scheduleId)) || null,
    )
    const owned = computed(() => Boolean(schedule.value && isOwner(schedule.value)))

    /** @type {import('vue').Ref<'private' | 'shared' | 'public'>} */
    const visibility = ref('private')
    /** @type {import('vue').Ref<'owner' | 'shared' | 'public'>} */
    const suggestMode = ref('owner')
    const viewers = ref([])
    const suggesters = ref([])
    const viewerDraft = ref('')
    const suggesterDraft = ref('')
    const feedback = ref('')
    const saving = ref(false)
    // Directory autocomplete for the access lists: as either draft is typed,
    // search the directory for matching accounts (debounced) and offer them
    // through the shared datalist.
    const nameSuggestions = ref([])
    let nameSearchTimer = null
    watch([viewerDraft, suggesterDraft], ([viewer, suggester]) => {
      clearTimeout(nameSearchTimer)
      const q = String(viewer || suggester || '').trim()
      if (!q) {
        nameSuggestions.value = []
        return
      }
      nameSearchTimer = setTimeout(async () => {
        nameSuggestions.value = await backend.searchUsers(q)
      }, 150)
    })

    // Load the form from the schedule whenever the target changes — the first
    // mount, a param change while the overlay stays mounted, or a deep link
    // whose collection is still loading when the overlay renders. Guarded by
    // id so a later store refresh (e.g. the save response replacing the row)
    // doesn't wipe in-progress edits.
    let initializedFor = null
    watch(
      [() => props.scheduleId, schedule],
      () => {
        const s = schedule.value
        if (!s || initializedFor === String(s.id)) return
        initializedFor = String(s.id)
        visibility.value = s.visibility || 'private'
        suggestMode.value = s.suggestMode || 'owner'
        viewers.value = [...(s.viewers || [])]
        suggesters.value = [...(s.suggesters || [])]
        viewerDraft.value = ''
        suggesterDraft.value = ''
        feedback.value = ''
      },
      { immediate: true },
    )

    // Adds the draft name to a list editor (trimmed + lowercased; the server
    // does the full canonicalization on save).
    const addViewer = () => {
      const raw = viewerDraft.value.trim()
      if (!raw) return
      const canonical = raw.toLowerCase()
      if (!viewers.value.includes(canonical)) viewers.value = [...viewers.value, canonical]
      viewerDraft.value = ''
    }
    const addSuggester = () => {
      const raw = suggesterDraft.value.trim()
      if (!raw) return
      const canonical = raw.toLowerCase()
      if (!suggesters.value.includes(canonical)) suggesters.value = [...suggesters.value, canonical]
      suggesterDraft.value = ''
    }
    const saveAccess = async () => {
      if (saving.value || !schedule.value) return
      saving.value = true
      feedback.value = ''
      const saved = await updateScheduleAccess(schedule.value.id, {
        visibility: visibility.value,
        suggestMode: suggestMode.value,
        viewers: viewers.value,
        suggesters: suggesters.value,
      })
      saving.value = false
      if (saved) {
        close()
        return
      }
      feedback.value = 'Could not save — check the usernames and that you own this schedule.'
    }

    return {
      modalEl,
      close,
      schedule,
      owned,
      visibility,
      suggestMode,
      viewers,
      suggesters,
      viewerDraft,
      suggesterDraft,
      feedback,
      saving,
      nameSuggestions,
      addViewer,
      addSuggester,
      saveAccess,
      displayName,
    }
  },
}
</script>
