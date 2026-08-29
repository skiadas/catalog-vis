// "Your schedules" management modal plus the "New schedule" creation modal it
// opens. Read/writes the schedule collection via the module store directly;
// the caller controls visibility through the `isOpen` prop.

import {
  schedules,
  selectedScheduleIds,
  toggleSchedule,
  deleteSchedule,
  duplicateSchedule,
  generateSchedule,
  editingScheduleId,
  activeTerm,
  termOfferings,
} from '../src/scheduleStore.js'
import { allCourses } from '@major-vis/catalog-client'
import { colorForSchedule, TERM_KEYS, TERM_LABELS } from '@major-vis/schedule-core'
import ScheduleModeMenu from './ScheduleModeMenu.js'

import { ref, computed } from 'vue'

export default {
  name: 'ScheduleManage',
  components: { ScheduleModeMenu },
  props: {
    isOpen: { type: Boolean, default: false },
  },
  emits: ['close', 'edit'],
  setup(props, { emit }) {
    const manageQuery = ref('')
    const menuFor = ref(null)
    const filteredSchedules = computed(() => {
      const q = manageQuery.value.trim().toLowerCase()
      if (!q) return schedules.value
      return schedules.value.filter((s) => s.name.toLowerCase().includes(q))
    })

    const showCreate = ref(false)
    const newKind = ref('empty')
    const newName = ref('')
    const newYear = ref('')
    const newDept = ref('')
    const deptOptions = computed(() => {
      const set = new Set()
      for (const code of Object.keys(allCourses.value)) set.add(code.split(' ')[0])
      return Array.from(set).sort()
    })
    const openCreate = () => {
      showCreate.value = true
      if (!newDept.value && deptOptions.value.length) newDept.value = deptOptions.value[0]
    }
    const doCreate = () => {
      const mode = newKind.value === 'dept' ? 'dept' : newKind.value === 'empty' ? 'empty' : 'random'
      const dept = mode === 'dept' ? newDept.value || deptOptions.value[0] : undefined
      generateSchedule({ mode, dept, name: newName.value, year: newYear.value })
      newName.value = ''
      newYear.value = ''
      newKind.value = 'empty'
      showCreate.value = false
    }

    const removeSchedule = (id) => deleteSchedule(id)
    // Duplicates a schedule, then drops into edit mode on the copy (which is
    // auto-selected by `duplicateSchedule`).
    const duplicateAndEdit = (id) => {
      const newId = duplicateSchedule(id)
      if (newId) emit('edit', newId)
    }
    // Editing (like duplicating) is delegated to the parent's `enterEdit`,
    // which initializes the edit-bar name draft and returns to the grid view.
    const editSchedule = (id, role = 'edit') => {
      menuFor.value = null
      emit('edit', id, role)
    }

    const close = () => emit('close')

    return {
      props,
      close,
      manageQuery,
      filteredSchedules,
      showCreate,
      newKind,
      newName,
      newYear,
      newDept,
      deptOptions,
      openCreate,
      doCreate,
      removeSchedule,
      duplicateAndEdit,
      schedules,
      selectedScheduleIds,
      toggleSchedule,
      editingScheduleId,
      editSchedule,
      menuFor,
      colorForSchedule,
      activeTerm,
      termOfferings,
      TERM_KEYS,
      TERM_LABELS,
    }
  },
  template: `
    <div v-if="props.isOpen" class="modal-overlay" @click.self="close">
      <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="schedule-manage-title">
        <div class="modal-head">
          <h3 id="schedule-manage-title">Your schedules</h3>
          <button class="modal-close" @click="close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="modal-intro">
            These schedules live in this browser. Toggle which ones are displayed, generate new ones, or delete
            schedules you no longer need.
          </p>
          <input
            class="search-input schedule-manage-search"
            type="search"
            placeholder="Search schedules…"
            v-model="manageQuery"
          />
          <div class="schedule-manage-list">
            <div v-for="s in filteredSchedules" :key="s.id" class="schedule-manage-row">
              <span class="schedule-swatch" :style="{ backgroundColor: colorForSchedule(s.id) }"></span>
              <div class="schedule-manage-main">
                <div class="schedule-manage-name">{{ s.name }}</div>
                <div class="schedule-manage-meta">
                  {{ s.year || '—' }} · {{ termOfferings(s).length }} offerings this term
                  <span v-if="TERM_KEYS.some((t) => termOfferings(s, t).length)"> ·
                    {{ TERM_KEYS.map((t) => (termOfferings(s, t).length ? TERM_LABELS[t] + ': ' + termOfferings(s, t).length : '')).filter(Boolean).join(', ') }}
                  </span>
                </div>
              </div>
              <button
                class="schedule-manage-eye"
                :aria-label="(selectedScheduleIds.includes(s.id) ? 'Hide' : 'Show') + ' ' + s.name"
                :class="{ active: selectedScheduleIds.includes(s.id) }"
                :title="(selectedScheduleIds.includes(s.id) ? 'Hide' : 'Show') + ' ' + s.name"
                @click="toggleSchedule(s.id)"
              >
                <svg v-if="selectedScheduleIds.includes(s.id)" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
              <span class="mode-menu-wrap">
                <button
                  class="schedule-manage-icon"
                  :class="{ active: menuFor === s.id || editingScheduleId === s.id }"
                  :aria-label="'Edit or suggest changes for ' + s.name"
                  :title="'Edit or suggest changes for ' + s.name"
                  @click="menuFor = menuFor === s.id ? null : s.id"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                </button>
                <ScheduleModeMenu :schedule="s" :open="menuFor === s.id" @mode="editSchedule" @close="menuFor = null" />
              </span>
              <button
                class="schedule-manage-icon"
                :aria-label="'Duplicate ' + s.name"
                :title="'Duplicate ' + s.name"
                @click="duplicateAndEdit(s.id)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
              <button
                class="schedule-manage-del"
                :aria-label="'Delete ' + s.name"
                :title="'Delete ' + s.name"
                @click="removeSchedule(s.id)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </button>
            </div>
          </div>
          <div v-if="filteredSchedules.length === 0" class="schedule-manage-empty">No schedules match "{{ manageQuery }}".</div>
          <button class="filter-btn primary" @click="openCreate">＋ New schedule</button>
        </div>
      </div>
    </div>

    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-create-title">
        <div class="modal-head">
          <h3 id="schedule-create-title">New schedule</h3>
          <button class="modal-close" @click="showCreate = false" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="schedule-create-name">Name (optional)</label>
            <input id="schedule-create-name" class="search-input" type="text" placeholder="Auto-named if blank" v-model="newName" />
          </div>
          <div class="field">
            <label for="schedule-create-year">Year (optional)</label>
            <input id="schedule-create-year" class="search-input" type="text" placeholder="e.g. 2026-27" v-model="newYear" />
          </div>
          <div class="field">
            <label>Type</label>
            <div class="schedule-type-options">
              <button class="filter-btn" :class="{ active: newKind === 'empty' }" @click="newKind = 'empty'">Empty</button>
              <span class="schedule-type-divider"></span>
              <span class="schedule-type-label">Random</span>
              <div class="filter-group">
                <button class="filter-btn" :class="{ active: newKind === 'random' }" @click="newKind = 'random'">All departments</button>
                <button class="filter-btn" :class="{ active: newKind === 'dept' }" @click="newKind = 'dept'">Single department</button>
              </div>
            </div>
          </div>
          <div class="field" v-if="newKind === 'dept'">
            <label for="schedule-create-dept">Department</label>
            <select id="schedule-create-dept" class="search-input" v-model="newDept">
              <option v-for="d in deptOptions" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
          <div class="controls">
            <button class="filter-btn primary" @click="doCreate">Generate</button>
          </div>
        </div>
      </div>
    </div>
  `,
}
