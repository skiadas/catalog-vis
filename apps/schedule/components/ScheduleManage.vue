<template>
  <section class="schedule-manage-page" aria-labelledby="schedule-manage-title">
    <div class="modal modal-wide">
      <div class="modal-head">
        <h3 id="schedule-manage-title">Your schedules</h3>
        <button class="filter-btn" @click="close">← Back</button>
      </div>
      <div class="modal-body">
        <p class="modal-intro" v-if="remote">
          Your schedules come first. Shared ones are one search away — find them by name or owner, then toggle
          them on to see them. Only owners can edit or delete a schedule; the rest accept suggested changes.
        </p>
        <p class="modal-intro" v-else>
          These schedules live in this browser. Toggle which ones are displayed, generate new ones, or delete
          schedules you no longer need.
        </p>
        <div class="schedule-manage-tools">
          <input
            class="search-input schedule-manage-search"
            type="search"
            placeholder="Search name or owner…"
            aria-label="Search schedules"
            v-model="manageQuery"
          />
          <select
            v-if="yearOptions.length"
            id="schedule-manage-year"
            class="search-input schedule-manage-year"
            aria-label="Filter by year"
            v-model="yearFilter"
          >
            <option value="">All years</option>
            <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}</option>
          </select>
        </div>
        <div class="schedule-manage-list">
          <template v-for="group in listGroups" :key="group.label">
            <div v-if="group.rows.length" class="schedule-manage-section-title">
              {{ group.label }} ({{ group.rows.length }})
            </div>
            <div
              v-for="s in group.rows"
              :key="s.id"
              class="schedule-manage-row"
              :class="{ 'menu-open': menuFor === s.id }"
            >
              <span class="schedule-swatch" :style="{ backgroundColor: colorForSchedule(s.id) }"></span>
              <div class="schedule-manage-main">
                <div class="schedule-manage-name">{{ s.name }}</div>
                <div class="schedule-manage-meta">
                  {{ s.year || '—' }} · {{ viewOfferings(s).length }} offerings this term
                  <span v-if="TERM_KEYS.some((t) => viewOfferings(s, t).length)">
                    ·
                    {{
                      TERM_KEYS.map((t) =>
                        viewOfferings(s, t).length ? TERM_LABELS[t] + ': ' + viewOfferings(s, t).length : '',
                      )
                        .filter(Boolean)
                        .join(', ')
                    }}
                  </span>
                  <span class="schedule-manage-owner">{{ ownerLabel(s) }}</span>
                  <span class="schedule-manage-access" :title="accessTitle(s)">{{ accessBadge(s) }}</span>
                </div>
              </div>
              <button
                v-if="isOwner(s)"
                class="schedule-manage-icon"
                :aria-label="'Access for ' + s.name"
                :title="'Who can see and suggest changes for ' + s.name"
                @click="openAccess(s)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </button>
              <button
                class="schedule-manage-eye"
                :aria-label="(selectedScheduleIds.includes(s.id) ? 'Hide' : 'Show') + ' ' + s.name"
                :class="{ active: selectedScheduleIds.includes(s.id) }"
                :title="(selectedScheduleIds.includes(s.id) ? 'Hide' : 'Show') + ' ' + s.name"
                @click="toggleSchedule(s.id)"
              >
                <svg
                  v-if="selectedScheduleIds.includes(s.id)"
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <svg
                  v-else
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </button>
              <span class="mode-menu-wrap">
                <button
                  class="schedule-manage-icon"
                  :class="{ active: menuFor === s.id || editingScheduleId === s.id }"
                  :aria-label="'Edit or suggest changes for ' + s.name"
                  :title="'Edit or suggest changes for ' + s.name"
                  @click="menuFor = menuFor === s.id ? null : s.id"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="15"
                    height="15"
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
                <ScheduleModeMenu
                  :schedule="s"
                  :open="menuFor === s.id"
                  @mode="editSchedule"
                  @close="menuFor = null"
                />
              </span>
              <button
                class="schedule-manage-icon"
                :aria-label="'Duplicate ' + s.name"
                :title="editing ? 'Finish editing before duplicating' : 'Duplicate ' + s.name"
                :disabled="editing"
                @click="duplicateAndEdit(s.id)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
              <button
                v-if="canDelete(s)"
                class="schedule-manage-del"
                :aria-label="'Delete ' + s.name"
                :title="'Delete ' + s.name"
                @click="removeSchedule(s.id)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            </div>
          </template>
        </div>
        <div v-if="noRows" class="schedule-manage-empty">No schedules match "{{ manageQuery }}".</div>
        <button
          class="filter-btn primary"
          :disabled="editing"
          :title="editing ? 'Finish editing before creating a new schedule' : ''"
          @click="openCreate"
        >
          ＋ New schedule
        </button>
      </div>
    </div>
  </section>

  <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
    <div ref="createEl" class="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-create-title">
      <div class="modal-head">
        <h3 id="schedule-create-title">New schedule</h3>
        <button class="modal-close" @click="showCreate = false" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label for="schedule-create-name">Name (optional)</label>
          <input
            id="schedule-create-name"
            class="search-input"
            type="text"
            placeholder="Auto-named if blank"
            v-model="newName"
          />
          <span v-if="csvName" class="schedule-import-hint">from {{ csvName }}</span>
        </div>
        <div class="field">
          <label for="schedule-create-year">Year (optional)</label>
          <input
            id="schedule-create-year"
            class="search-input"
            type="text"
            placeholder="e.g. 2026-27"
            v-model="newYear"
          />
        </div>
        <div v-if="csvRows" class="schedule-import-summary" role="status">
          <p class="schedule-import-line">
            <strong>Imported {{ csvRows.length }} course row(s)</strong> into {{ csvParts.join(' + ') }}.
            <button class="schedule-import-remove" @click="clearCsv()" aria-label="Remove file">×</button>
          </p>
          <p v-if="importWarning.length" class="schedule-upload-warning">
            <strong
              >{{ importWarning.length }} lab row(s) with no matching lecture section in the file</strong
            >
            (kept as unscheduled labs):
            <span v-for="l in importWarning" :key="l.key" class="schedule-upload-warning-item">{{
              l.label
            }}</span>
          </p>
        </div>
        <div v-else class="field">
          <span class="field-label">Type</span>
          <div class="schedule-type-options">
            <button
              class="filter-btn"
              :class="{ active: newKind === 'empty' }"
              :aria-pressed="newKind === 'empty'"
              @click="newKind = 'empty'"
            >
              Empty
            </button>
            <span class="schedule-type-divider"></span>
            <span class="schedule-type-label">Random</span>
            <div class="filter-group">
              <button
                class="filter-btn"
                :class="{ active: newKind === 'random' }"
                :aria-pressed="newKind === 'random'"
                @click="newKind = 'random'"
              >
                All departments
              </button>
              <button
                class="filter-btn"
                :class="{ active: newKind === 'dept' }"
                :aria-pressed="newKind === 'dept'"
                @click="newKind = 'dept'"
              >
                Single department
              </button>
            </div>
          </div>
        </div>
        <div class="field" v-if="newKind === 'dept' && !csvRows">
          <label for="schedule-create-dept">Department</label>
          <select id="schedule-create-dept" class="search-input" v-model="newDept">
            <option v-for="d in deptOptions" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
        <p v-if="csvError" class="schedule-create-error" role="alert">{{ csvError }}</p>
        <div class="controls">
          <button
            class="filter-btn"
            :disabled="creating || editing"
            :title="editing ? 'Finish editing before importing' : ''"
            @click="pickCsvFile()"
          >
            Import CSV…
          </button>
          <button class="filter-btn primary" :disabled="creating || editing" @click="doCreate">
            {{ creating ? 'Creating…' : csvRows ? 'Import' : 'Generate' }}
          </button>
        </div>
      </div>
    </div>
  </div>
  <div v-if="showAccess" class="modal-overlay" @click.self="closeAccess">
    <div ref="accessEl" class="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-access-title">
      <div class="modal-head">
        <h3 id="schedule-access-title">Access — {{ accessSchedule && accessSchedule.name }}</h3>
        <button class="modal-close" @click="closeAccess" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p v-if="accessFeedback" class="suggested-feedback" role="status">{{ accessFeedback }}</p>
        <div class="field">
          <label for="access-visibility">Who can see this schedule?</label>
          <select id="access-visibility" class="search-input" v-model="accessVisibility">
            <option value="private">Only you</option>
            <option value="shared">Listed users</option>
            <option value="public">Everyone</option>
          </select>
        </div>
        <div v-if="accessVisibility === 'shared'" class="field">
          <span class="field-label">Viewers</span>
          <div v-if="accessViewers.length" class="access-list">
            <div v-for="u in accessViewers" :key="u" class="access-list-row">
              <span>{{ displayName(u) }}</span>
              <button
                class="access-list-remove"
                :aria-label="'Remove ' + displayName(u)"
                title="Remove"
                @click="accessViewers.splice(accessViewers.indexOf(u), 1)"
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
              v-model="accessViewerDraft"
              @keydown.enter.prevent="addViewer"
            />
            <button class="filter-btn" :disabled="!accessViewerDraft.trim()" @click="addViewer">Add</button>
          </div>
        </div>
        <div class="field">
          <label for="access-suggest">Who can suggest changes?</label>
          <select id="access-suggest" class="search-input" v-model="accessSuggestMode">
            <option value="owner">Only you</option>
            <option value="shared">Listed users</option>
            <option value="public">Everyone</option>
          </select>
        </div>
        <div v-if="accessSuggestMode === 'shared'" class="field">
          <span class="field-label">Suggesters</span>
          <div v-if="accessSuggesters.length" class="access-list">
            <div v-for="u in accessSuggesters" :key="u" class="access-list-row">
              <span>{{ displayName(u) }}</span>
              <button
                class="access-list-remove"
                :aria-label="'Remove ' + displayName(u)"
                title="Remove"
                @click="accessSuggesters.splice(accessSuggesters.indexOf(u), 1)"
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
              v-model="accessSuggesterDraft"
              @keydown.enter.prevent="addSuggester"
            />
            <button class="filter-btn" :disabled="!accessSuggesterDraft.trim()" @click="addSuggester">
              Add
            </button>
          </div>
        </div>
        <datalist id="access-user-names">
          <option v-for="u in nameSuggestions" :key="u.username" :value="u.username">
            {{ displayName(u.displayName || u.username) }}
          </option>
        </datalist>
        <p class="modal-intro">
          A listed suggester can always see the schedule too. Everyone signed in can see and propose on public
          schedules.
        </p>
        <div class="controls">
          <span class="controls-spacer"></span>
          <button class="filter-btn" @click="closeAccess">Cancel</button>
          <button class="filter-btn primary" :disabled="savingAccess" @click="saveAccess">
            {{ savingAccess ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
    </div>
  </div>
  <input
    ref="csvInput"
    type="file"
    accept=".csv,text/csv"
    aria-label="Upload CSV file"
    class="schedule-upload-input"
    @change="onCsvChange"
  />
</template>

<script>
// "Your schedules" management page (route `/schedules`) plus the "New
// schedule" creation dialog and the owner-only Access dialog it opens.
// Read/writes the schedule collection via the module store directly; the
// parent closes the page by navigating back (the `close` event).

import {
  schedules,
  selectedScheduleIds,
  toggleSchedule,
  deleteSchedule,
  duplicateSchedule,
  generateSchedule,
  addSchedule,
  importCsvRows,
  editingScheduleId,
  activeTerm,
  viewOfferings,
  remote,
  isOwner,
  updateScheduleAccess,
} from '../src/scheduleStore.js'
import { allCourses } from '@major-vis/catalog-client'
import { colorForSchedule, TERM_KEYS, TERM_LABELS, parseCsv } from '@major-vis/schedule-core'
import { useModalFocus } from '../src/modalFocus.js'
import { displayName } from '../src/names.js'
import * as backend from '../src/backend.js'
import ScheduleModeMenu from './ScheduleModeMenu.vue'

import { ref, computed, watch } from 'vue'

export default {
  name: 'ScheduleManage',
  components: { ScheduleModeMenu },
  emits: ['close', 'edit'],
  setup(_, { emit }) {
    const manageQuery = ref('')
    const menuFor = ref(null)
    // Year filter: '' is "All years"; the dropdown lists the years present.
    const yearFilter = ref('')
    const yearOptions = computed(() => {
      const set = new Set(schedules.value.map((s) => s.year).filter(Boolean))
      return Array.from(set).sort().reverse()
    })
    // New-schedule / duplicate / import actions stay off while a session is
    // active, so an edit in progress is never disturbed by a concurrent create.
    const editing = computed(() => Boolean(editingScheduleId.value))
    const filteredSchedules = computed(() => {
      const q = manageQuery.value.trim().toLowerCase()
      const yr = yearFilter.value
      return schedules.value.filter((s) => {
        if (yr && s.year !== yr) return false
        if (!q) return true
        const owner = String(s.owner || '')
        return (
          s.name.toLowerCase().includes(q) ||
          owner.toLowerCase().includes(q) ||
          displayName(owner).toLowerCase().includes(q)
        )
      })
    })
    const ownedRows = computed(() => filteredSchedules.value.filter((s) => isOwner(s)))
    // Schedules the user may view but does not own, split into the ones shared
    // with them specifically (named in viewers/suggesters — a suggester on a
    // still-private schedule counts) and the ones everyone can see.
    const sharedRows = computed(() =>
      filteredSchedules.value.filter((s) => !isOwner(s) && s.visibility !== 'public'),
    )
    const publicRows = computed(() =>
      filteredSchedules.value.filter((s) => !isOwner(s) && s.visibility === 'public'),
    )
    // The list renders as sections (your own first, then what is shared with
    // you, then public schedules) so the row markup lives in one place.
    const listGroups = computed(() => {
      const groups = []
      if (ownedRows.value.length) groups.push({ label: 'Your schedules', rows: ownedRows.value })
      if (remote.value && sharedRows.value.length)
        groups.push({ label: 'Shared with you', rows: sharedRows.value })
      if (remote.value && publicRows.value.length) groups.push({ label: 'Public', rows: publicRows.value })
      return groups
    })
    const noRows = computed(() => !listGroups.value.length)

    const showCreate = ref(false)
    const newKind = ref('empty')
    const newName = ref('')
    const newYear = ref('')
    const newDept = ref('')
    const csvInput = ref(null)
    const csvRows = ref(null)
    const csvName = ref('')
    const csvError = ref('')
    const deptOptions = computed(() => {
      const set = new Set()
      for (const code of Object.keys(allCourses.value)) set.add(code.split(' ')[0])
      return Array.from(set).sort()
    })
    const openCreate = () => {
      if (editing.value) return
      showCreate.value = true
      createError.value = ''
      csvError.value = ''
      if (!newDept.value && deptOptions.value.length) newDept.value = deptOptions.value[0]
    }
    // Parsed CSV rows, the filename they came from, and the term parts they
    // would fill (rows without a `term` column land in the active term part).
    const csvParts = computed(() => {
      const seen = []
      for (const r of csvRows.value || []) {
        const t = r.term && TERM_KEYS.includes(r.term.toUpperCase()) ? r.term.toUpperCase() : activeTerm.value
        if (!seen.includes(t)) seen.push(t)
      }
      return seen.map((t) => TERM_LABELS[t])
    })
    // Lab rows without a matching lecture in the same file are kept (dropping
    // data silently is worse) but flagged for the importer.
    const importWarning = computed(() => {
      const rows = csvRows.value || []
      return rows
        .filter(
          (r) =>
            r.lab &&
            !rows.some(
              (x) => !x.lab && x.prefix === r.prefix && x.number === r.number && x.section === r.section,
            ),
        )
        .map((r) => ({
          key: `${r.prefix}|${r.number}|${r.section}|${r.labSeq || 1}`,
          label: `${r.prefix} ${r.number}L ${r.section}${r.labSeq || 1}`,
        }))
    })
    const pickCsvFile = () => {
      csvInput.value && csvInput.value.click()
    }
    const clearCsv = () => {
      csvRows.value = null
      csvName.value = ''
      csvError.value = ''
    }
    // Reads a CSV file into parsed rows (never imports directly): the summary
    // shows what would be created, and the confirm button becomes "Import".
    const onCsvChange = (e) => {
      const file = e.target.files && e.target.files[0]
      e.target.value = ''
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const rows = parseCsv(String(reader.result || ''))
        if (!rows.length) {
          csvError.value = 'No course rows found in that file.'
          return
        }
        csvRows.value = rows
        csvName.value = file.name
        csvError.value = ''
        newName.value = file.name.replace(/\.csv$/i, '').replace(/[. ]+$/g, '') || newName.value
      }
      reader.readAsText(file)
    }
    // The creator stays open until the schedule exists server-side (no
    // optimistic ghosts): the button shows progress and the modal keeps the
    // user's inputs on a failed create so they can retry.
    const creating = ref(false)
    const createError = ref('')
    const doCreate = async () => {
      if (creating.value) return
      creating.value = true
      createError.value = ''
      csvError.value = ''
      if (csvRows.value) {
        const id = await addSchedule(newName.value, newYear.value)
        if (id == null) {
          createError.value = 'Could not create the schedule — the server did not confirm. Try again?'
          creating.value = false
          return
        }
        importCsvRows(id, csvRows.value)
      } else {
        const mode = newKind.value === 'dept' ? 'dept' : newKind.value === 'empty' ? 'empty' : 'random'
        const dept = mode === 'dept' ? newDept.value || deptOptions.value[0] : undefined
        const id = await generateSchedule({ mode, dept, name: newName.value, year: newYear.value })
        if (id == null) {
          createError.value = 'Could not create the schedule — the server did not confirm. Try again?'
          creating.value = false
          return
        }
      }
      creating.value = false
      newName.value = ''
      newYear.value = ''
      newKind.value = 'empty'
      clearCsv()
      showCreate.value = false
    }

    const removeSchedule = (id) => deleteSchedule(id)
    // "You" for owned schedules, the owner's short username otherwise (the server
    // joins the full identity into every row; humans see it without the
    // domain). Offline everything is the single local user.
    const ownerLabel = (s) => (isOwner(s) ? 'You' : s.owner ? `by ${displayName(s.owner)}` : '')

    // ---- Access dialog (owner-only) --------------------------------------
    // Who can see (visibility) and propose (suggestMode) for a schedule, with
    // the viewer/suggester username lists when the mode is 'shared'. The
    // dialog edits local copies and saves once; the server canonicalizes the
    // lists and the response replaces the row, so the UI echoes stored truth.
    const showAccess = ref(false)
    const accessSchedule = ref(null)
    /** @type {import('vue').Ref<'private' | 'shared' | 'public'>} */
    const accessVisibility = ref('private')
    /** @type {import('vue').Ref<'owner' | 'shared' | 'public'>} */
    const accessSuggestMode = ref('owner')
    const accessViewers = ref([])
    const accessSuggesters = ref([])
    const accessViewerDraft = ref('')
    const accessSuggesterDraft = ref('')
    const accessFeedback = ref('')
    const savingAccess = ref(false)
    // Directory autocomplete for the access lists: as either draft is typed,
    // search the directory for matching accounts (debounced) and offer them
    // through the shared datalist.
    const nameSuggestions = ref([])
    let nameSearchTimer = null
    watch([accessViewerDraft, accessSuggesterDraft], ([viewer, suggester]) => {
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
    const openAccess = (s) => {
      if (editing.value) return
      accessSchedule.value = s
      accessVisibility.value = s.visibility || 'private'
      accessSuggestMode.value = s.suggestMode || 'owner'
      accessViewers.value = [...(s.viewers || [])]
      accessSuggesters.value = [...(s.suggesters || [])]
      accessViewerDraft.value = ''
      accessSuggesterDraft.value = ''
      accessFeedback.value = ''
      showAccess.value = true
    }
    const closeAccess = () => {
      showAccess.value = false
      accessFeedback.value = ''
    }
    // Adds the draft name to a list editor (trimmed + lowercased; the server
    // does the full canonicalization on save).
    const addViewer = () => {
      const raw = accessViewerDraft.value.trim()
      if (!raw) return
      const canonical = raw.toLowerCase()
      if (!accessViewers.value.includes(canonical)) {
        accessViewers.value = [...accessViewers.value, canonical]
      }
      accessViewerDraft.value = ''
    }
    const addSuggester = () => {
      const raw = accessSuggesterDraft.value.trim()
      if (!raw) return
      const canonical = raw.toLowerCase()
      if (!accessSuggesters.value.includes(canonical)) {
        accessSuggesters.value = [...accessSuggesters.value, canonical]
      }
      accessSuggesterDraft.value = ''
    }
    const saveAccess = async () => {
      if (savingAccess.value || !accessSchedule.value) return
      savingAccess.value = true
      accessFeedback.value = ''
      const saved = await updateScheduleAccess(accessSchedule.value.id, {
        visibility: accessVisibility.value,
        suggestMode: accessSuggestMode.value,
        viewers: accessViewers.value,
        suggesters: accessSuggesters.value,
      })
      savingAccess.value = false
      if (saved) {
        closeAccess()
        return
      }
      accessFeedback.value = 'Could not save — check the usernames and that you own this schedule.'
    }
    // The row badge + tooltip: a one-word summary for owners/others to read at
    // a glance, full detail on hover.
    const VIS_LABEL = { private: 'private', shared: 'shared', public: 'public' }
    const SUGGEST_LABEL = { owner: 'only you', shared: 'listed users', public: 'everyone' }
    const accessBadge = (s) => {
      if (!s || !s.visibility) return ''
      if (s.visibility === 'shared') {
        return `${VIS_LABEL[s.visibility]} · ${(s.viewers || []).length} viewer${s.viewers.length === 1 ? '' : 's'}`
      }
      return VIS_LABEL[s.visibility] || ''
    }
    const accessTitle = (s) => {
      if (!s) return ''
      return `Visible to ${VIS_LABEL[s.visibility] || s.visibility}; suggestions: ${SUGGEST_LABEL[s.suggestMode] || s.suggestMode}`
    }
    // Deleting is owner-only server-side; a hidden button beats a delete that
    // silently resurrects on the next refresh. Offline: everything is owned.
    const canDelete = (s) => !remote.value || isOwner(s)
    // Duplicates a schedule, then drops into edit mode on the copy (which is
    // auto-selected by `duplicateSchedule`). Awaited: a failed duplicate keeps
    // the user where they are.
    const duplicateAndEdit = async (id) => {
      const newId = await duplicateSchedule(id)
      if (newId) emit('edit', newId)
    }
    // Editing (like duplicating) is delegated to the parent's `enterEdit`,
    // which initializes the edit-bar name draft and returns to the grid view.
    const editSchedule = (id, role = 'edit') => {
      menuFor.value = null
      emit('edit', id, role)
    }

    const close = () => emit('close')

    // The page itself is not a dialog, so it does not trap focus. The create
    // form it opens is a dialog; its trap is gated on the child being open so
    // only one listens at a time.
    const createEl = ref(null)
    const accessEl = ref(null)
    useModalFocus(showCreate, createEl, () => {
      showCreate.value = false
    })
    useModalFocus(showAccess, accessEl, closeAccess)

    return {
      close,
      createEl,
      manageQuery,
      yearFilter,
      yearOptions,
      listGroups,
      noRows,
      editing,
      showCreate,
      creating,
      createError,
      newKind,
      newName,
      newYear,
      newDept,
      deptOptions,
      openCreate,
      doCreate,
      pickCsvFile,
      onCsvChange,
      clearCsv,
      csvInput,
      csvRows,
      csvName,
      csvParts,
      importWarning,
      csvError,
      removeSchedule,
      ownerLabel,
      canDelete,
      displayName,
      isOwner,
      remote,
      duplicateAndEdit,
      showAccess,
      accessSchedule,
      accessEl,
      accessVisibility,
      accessSuggestMode,
      accessViewers,
      accessSuggesters,
      accessViewerDraft,
      accessSuggesterDraft,
      accessFeedback,
      savingAccess,
      openAccess,
      closeAccess,
      addViewer,
      addSuggester,
      saveAccess,
      accessBadge,
      accessTitle,
      nameSuggestions,
      schedules,
      selectedScheduleIds,
      toggleSchedule,
      editingScheduleId,
      editSchedule,
      menuFor,
      colorForSchedule,
      activeTerm,
      viewOfferings,
      TERM_KEYS,
      TERM_LABELS,
    }
  },
}
</script>
