<template>
  <div class="schedule-picker">
    <div class="schedule-picker-left">
      <button v-if="!editMode" class="filter-btn" @click="manage">
        Your schedules <span class="schedule-picker-count">{{ selectedScheduleIds.length }}</span>
      </button>
      <span
        v-for="s in visibleSchedules"
        :key="s.id"
        class="schedule-pill"
        :class="{
          editing: editMode && s.id === editingId,
          reference: editMode && s.id !== editingId,
        }"
        :style="{ backgroundColor: colorForSchedule(s.id) }"
        :title="editMode && s.id === editingId ? s.name : 'Hide ' + s.name + ownerSuffix(s)"
        tabindex="0"
        @click="onPill(s)"
        @keydown="onKeyActivate($event, () => onPill(s))"
      >
        <span class="schedule-pill-label"
          >{{ s.name
          }}<span v-if="ownerSuffix(s)" class="schedule-pill-owner">{{ ownerSuffix(s) }}</span></span
        >
        <span v-if="editMode && s.id === editingId" class="schedule-pill-editing">{{
          editingRole === 'suggest' ? 'Suggesting' : 'Editing'
        }}</span>
        <template v-if="!editMode">
          <button
            v-if="canEdit(s)"
            class="schedule-pill-edit"
            type="button"
            title="Edit this schedule directly"
            :aria-label="'Edit ' + s.name"
            @click.stop="edit(s.id, 'edit')"
          >
            <IconPencil :size="13" :stroke-width="2.2" />
          </button>
          <button
            v-if="canSuggest(s)"
            class="schedule-pill-suggest"
            type="button"
            title="Propose changes collected for the owner to approve"
            :aria-label="'Suggest changes for ' + s.name"
            @click.stop="edit(s.id, 'suggest')"
          >
            <IconMessageSquarePlus :size="13" :stroke-width="2.2" />
          </button>
        </template>
        <button
          v-if="!editMode || s.id !== editingId"
          class="schedule-pill-hide"
          :title="'Hide ' + s.name"
          aria-label="Hide schedule"
          @click.stop="toggleSchedule(s.id)"
        >
          <IconEye :size="13" :stroke-width="2.2" />
        </button>
      </span>
      <button v-if="!editMode && !selectedScheduleIds.length" class="filter-clear" @click="manage">
        No schedule selected — pick one
      </button>
    </div>

    <div v-if="!editMode" class="schedule-picker-right">
      <button
        v-if="selectedScheduleIds.length"
        class="filter-btn schedule-color-toggle"
        :class="{ active: scheduleColorApplicable && colorSchedules }"
        :disabled="!scheduleColorApplicable"
        :aria-pressed="scheduleColorApplicable && colorSchedules"
        :title="
          scheduleColorApplicable
            ? selectedScheduleIds.length > 1
              ? 'Color each course by which schedule it belongs to'
              : 'Show the actual course list instead of a count summary'
            : filterActive
              ? 'A filter is active — clear it to color by schedule'
              : 'Select a schedule to color it'
        "
        @click="setColorSchedules(!colorSchedules)"
      >
        {{ selectedScheduleIds.length > 1 ? 'Color by schedule' : 'See individual courses' }}
      </button>

      <div class="schedule-csv-wrap" v-if="selectedScheduleIds.length" @click.stop>
        <button
          class="filter-btn"
          :class="{ active: csvOpen }"
          title="Schedule CSV actions"
          @click="csvOpen = !csvOpen"
          @keydown.esc="closeCsv()"
        >
          CSV <span class="schedule-csv-caret">▾</span>
        </button>
        <div v-if="csvOpen" class="csv-menu" @keydown.esc="closeCsv()">
          <button
            class="csv-menu-item"
            :disabled="!visibleSchedules.length"
            @click="downloadSummaryCsv(), closeCsv()"
          >
            Download summary CSV
          </button>
          <button
            v-if="selectedScheduleIds.length === 1"
            class="csv-menu-item"
            @click="downloadRegistrarCsv(selectedScheduleIds[0]), closeCsv()"
          >
            Download registrar CSV
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// The schedule-selection area: visible schedule pills, the color-by-schedule
// toggle, the CSV download, and the "Your schedules" manage trigger. Read-only
// on the schedule collection (store); editing/managing are delegated upward via
// events so the parent can initialize edit-mode state.

import {
  schedules,
  selectedScheduleIds,
  toggleSchedule,
  colorSchedules,
  setColorSchedules,
  filterMode,
  selectedDepartments,
  selectedInstructors,
  activeTerm,
  viewOfferings,
  publishedOfferings,
  isOwner,
  canSuggest,
  remote,
  editingScheduleId,
  editingRole,
} from '../src/scheduleStore.js'
import {
  colorForSchedule,
  compareItems,
  renderCsv,
  courseNumberLabel,
  offeringSectionLabel,
} from '@major-vis/schedule-core'
import { onKeyActivate } from '../src/keyboardNav.js'
import { displayName } from '../src/names.js'

import { computed, ref, onMounted, onBeforeUnmount } from 'vue'

export default {
  name: 'SchedulePicker',
  emits: ['edit', 'manage', 'createterm'],
  setup(_, { emit }) {
    const visibleSchedules = computed(() =>
      schedules.value.filter((s) => selectedScheduleIds.value.includes(s.id)),
    )
    // The pill offers each mode the user may actually start: an Edit pencil for
    // owners/offline and a Suggest bubble when the schedule's suggest
    // permission admits them. A viewer-only schedule shows neither (the manage
    // row's access summary explains why).
    const canEdit = (s) => !remote.value || isOwner(s)
    // While a session is active the strip is reduced: the edited schedule's
    // pill is marked "Editing"/"Suggesting" (and can't be hidden), the other
    // selected schedules are dimmed read-only references (the eye still removes
    // one from the view), and the manage/CSV/color controls are gone — the only
    // exits are Done and leaving.
    const editingId = editingScheduleId
    const editMode = computed(() => editingScheduleId.value != null)
    const onPill = (s) => {
      if (editMode.value && s.id === editingId.value) return
      toggleSchedule(s.id)
    }
    // Owner hint for a schedule: " (by registrar)" on shared rows, nothing for
    // the user's own ("You" everywhere would just be noise on the pills).
    const ownerSuffix = (s) => (isOwner(s) ? '' : s.owner ? ` (by ${displayName(s.owner)})` : '')

    // CSV action menu: a single "CSV ▾" button in the picker's right cluster.
    // Clicking anywhere else on the page closes it.
    const csvOpen = ref(false)
    const closeCsv = () => {
      csvOpen.value = false
    }
    onMounted(() => document.addEventListener('click', closeCsv))
    onBeforeUnmount(() => document.removeEventListener('click', closeCsv))
    const filterActive = computed(
      () =>
        (filterMode.value === 'dept' && selectedDepartments.value.length > 0) ||
        (filterMode.value === 'instructor' && selectedInstructors.value.length > 0),
    )
    const scheduleColorApplicable = computed(
      () => selectedScheduleIds.value.length > 0 && !filterActive.value,
    )

    // CSV escaping: quote cells containing commas, quotes, or newlines.
    const csvCell = (value) => {
      const s = String(value ?? '')
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    // Turns a schedule name into a safe download filename (strip path/quote
    // characters, collapse whitespace), falling back to a generic name.
    const csvFileName = (name) => {
      const safe = String(name || '')
        .replace(/[/\\:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '')
      return safe ? `${safe}.csv` : 'schedules.csv'
    }
    // Downloads one row per course offering across all selected (visible)
    // schedules' active term in the canonical registrar format (dept_prefix,
    // course_number, course_section, instructor, secondary_instr, days, times,
    // term), so the file round-trips through Upload registrar CSV. Offerings
    // are ordered alphabetically by prefix, then number, then section. With a
    // single visible schedule the file is named after that schedule.
    const downloadSummaryCsv = () => {
      const rows = [
        [
          'dept_prefix',
          'course_number',
          'course_section',
          'instructor',
          'secondary_instr',
          'days',
          'times',
          'term',
        ],
      ]
      for (const s of visibleSchedules.value) {
        const offerings = [...viewOfferings(s, activeTerm.value)].sort((a, b) =>
          compareItems({ o: a }, { o: b }),
        )
        for (const o of offerings) {
          rows.push([
            o.prefix,
            // Labs export in the registrar shape (166L, section A2) so a
            // re-import round-trips the lab sequence.
            courseNumberLabel(o),
            offeringSectionLabel(o),
            o.instructor || '',
            (o.secondaryInstructors || []).join(', '),
            o.days || '',
            o.time || '',
            activeTerm.value,
          ])
        }
      }
      const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const only = visibleSchedules.value.length === 1 ? visibleSchedules.value[0].name : null
      a.download = only ? csvFileName(only) : 'schedules.csv'
      a.click()
      URL.revokeObjectURL(url)
    }

    // A term-aware round-trip of a full schedule in the canonical registrar
    // format. Only used when the user asks for a whole schedule.
    const downloadRegistrarCsv = (id) => {
      const s = schedules.value.find((x) => x.id === id)
      if (!s) return
      const rows = []
      for (const t of Object.keys(s.terms || {})) {
        for (const o of publishedOfferings(s, t).map((x) => ({ ...x, term: t }))) rows.push(o)
      }
      const csv = renderCsv(rows)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = csvFileName(s.name + ' registrar')
      a.click()
      URL.revokeObjectURL(url)
    }

    const edit = (id, role = 'edit') => emit('edit', id, role)
    const manage = () => emit('manage')

    return {
      visibleSchedules,
      ownerSuffix,
      selectedScheduleIds,
      editingId,
      editMode,
      editingRole,
      onPill,
      canEdit,
      canSuggest,
      scheduleColorApplicable,
      filterActive,
      colorSchedules,
      setColorSchedules,
      onKeyActivate,
      downloadSummaryCsv,
      downloadRegistrarCsv,
      toggleSchedule,
      colorForSchedule,
      edit,
      manage,
      csvOpen,
      closeCsv,
    }
  },
}
</script>
