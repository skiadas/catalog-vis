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
  termOfferings,
  setTermOfferings,
} from '../src/scheduleStore.js'
import { colorForSchedule, compareItems, parseCsv, renderCsv, TERM_LABELS } from '@major-vis/schedule-core'
import { courseName } from '@major-vis/catalog-client'

import { computed, ref } from 'vue'

export default {
  name: 'SchedulePicker',
  props: {
    active: { type: Boolean, default: false },
  },
  emits: ['edit', 'manage', 'createterm'],
  setup(props, { emit }) {
    const visibleSchedules = computed(() =>
      schedules.value.filter((s) => selectedScheduleIds.value.includes(s.id)),
    )
    const fileInput = ref(null)
    const importFor = ref(null)
    const importError = ref('')
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
    // schedules' active term: term, schedule name, course code+section, course
    // name, instructor, days, and time. Offerings are ordered alphabetically by
    // prefix, then number, then section. With a single visible schedule the file
    // is named after that schedule.
    const downloadCsv = () => {
      const rows = [['Term', 'Schedule', 'Course', 'Course name', 'Instructor', 'Days', 'Time']]
      for (const s of visibleSchedules.value) {
        const offerings = [...termOfferings(s, activeTerm.value)].sort((a, b) =>
          compareItems({ o: a }, { o: b }),
        )
        for (const o of offerings) {
          const code = `${o.prefix} ${o.number}`
          rows.push([
            TERM_LABELS[activeTerm.value],
            s.name,
            `${o.prefix} ${o.number} ${o.section}`,
            courseName(code),
            o.instructor || '',
            o.days || '',
            o.time || '',
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

    // The active term includes the term column; a term-aware round-trip of a full
    // schedule. Only used when the user asks for a whole schedule.
    const downloadTermCsv = (id) => {
      const s = schedules.value.find((x) => x.id === id)
      if (!s) return
      const rows = []
      for (const t of Object.keys(s.terms || {})) {
        for (const o of (s.terms[t]?.offerings || []).map((x) => ({ ...x, term: t }))) rows.push(o)
      }
      const csv = renderCsv(rows)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = csvFileName(s.name + ' full term')
      a.click()
      URL.revokeObjectURL(url)
    }

    const edit = (id) => emit('edit', id)
    const manage = () => emit('manage')

    // CSV upload: parses the file and loads it into a schedule's active term.
    // Rows carrying a `term` column land in that term part; blank-day/time rows
    // become unscheduled offerings. Replaces the schedule's current term
    // offerings (a full replace, like a registrar feed).
    const pickFile = (id) => {
      importFor.value = id
      importError.value = ''
      fileInput.value && fileInput.value.click()
    }
    const onFileChange = (e) => {
      const file = e.target.files && e.target.files[0]
      e.target.value = ''
      if (!file) return
      const reader = new FileReader()
      const targetSched = schedules.value.find((s) => s.id === importFor.value)
      reader.onload = () => {
        try {
          const rows = parseCsv(String(reader.result || ''))
          if (!rows.length) {
            importError.value = 'No course rows found in that file.'
            return
          }
          // Group rows by term (default the active term), then load each.
          const byTerm = {}
          for (const r of rows) {
            const t =
              r.term && ['F', 'W', 'S'].includes(r.term.toUpperCase())
                ? r.term.toUpperCase()
                : activeTerm.value
            if (!byTerm[t]) byTerm[t] = []
            const offering = { ...r }
            delete offering.term
            byTerm[t].push(offering)
          }
          for (const t of Object.keys(byTerm)) {
            if (targetSched) setTermOfferings(targetSched.id, t, byTerm[t])
          }
          emit('manage')
        } catch (err) {
          importError.value = 'Could not read that CSV: ' + err.message
        }
      }
      reader.readAsText(file)
    }

    return {
      props,
      visibleSchedules,
      selectedScheduleIds,
      scheduleColorApplicable,
      filterActive,
      colorSchedules,
      setColorSchedules,
      downloadCsv,
      downloadTermCsv,
      pickFile,
      onFileChange,
      fileInput,
      importError,
      toggleSchedule,
      colorForSchedule,
      edit,
      manage,
    }
  },
  template: `
    <div class="schedule-picker">
      <button class="filter-btn" :class="{ active: props.active }" @click="manage">
        Your schedules <span class="schedule-picker-count">{{ selectedScheduleIds.length }}</span>
      </button>
      <span
        v-for="s in visibleSchedules"
        :key="s.id"
        class="schedule-pill"
        :style="{ backgroundColor: colorForSchedule(s.id) }"
        :title="'Hide ' + s.name"
        @click="toggleSchedule(s.id)"
      >
        <span class="schedule-pill-label">{{ s.name }}</span>
        <button
          class="schedule-pill-edit"
          :title="'Edit ' + s.name"
          aria-label="Edit schedule"
          @click.stop="edit(s.id)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
        </button>
        <button
          class="schedule-pill-hide"
          :title="'Hide ' + s.name"
          aria-label="Hide schedule"
          @click.stop="toggleSchedule(s.id)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        </button>
      </span>
      <button
        v-if="selectedScheduleIds.length"
        class="filter-btn schedule-color-toggle"
        :class="{ active: scheduleColorApplicable && colorSchedules }"
        :disabled="!scheduleColorApplicable"
        :title="scheduleColorApplicable
          ? (selectedScheduleIds.length > 1
              ? 'Color each course by which schedule it belongs to'
              : 'Show the actual course list instead of a count summary')
          : filterActive
            ? 'A filter is active — clear it to color by schedule'
            : 'Select a schedule to color it'"
        @click="setColorSchedules(!colorSchedules)"
      >{{ selectedScheduleIds.length > 1 ? 'Color by schedule' : 'See individual courses' }}</button>
      <button
        v-if="selectedScheduleIds.length"
        class="filter-btn"
        title="Download a CSV of every course in the visible schedules"
        :disabled="!visibleSchedules.length"
        @click="downloadCsv"
      >Download CSV</button>
      <button
        v-if="selectedScheduleIds.length === 1"
        class="filter-btn"
        title="Download the full year (all three terms) as a CSV"
        @click="downloadTermCsv(selectedScheduleIds[0])"
      >Download year CSV</button>
      <span class="schedule-upload-wrap">
        <button
          v-if="selectedScheduleIds.length === 1"
          class="filter-btn"
          title="Load courses from a CSV into this schedule's active term"
          @click="pickFile(selectedScheduleIds[0])"
        >Upload CSV</button>
        <input
          ref="fileInput"
          type="file"
          accept=".csv,text/csv"
          class="schedule-upload-input"
          @change="onFileChange"
        />
        <span v-if="importError" class="schedule-upload-error">{{ importError }}</span>
      </span>
      <button v-if="!selectedScheduleIds.length" class="filter-clear" @click="manage">No schedule selected — pick one</button>
    </div>
  `,
}
