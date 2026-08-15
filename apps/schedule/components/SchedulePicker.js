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
} from '../src/scheduleStore.js'
import { colorForSchedule, compareItems } from '@major-vis/schedule-core'
import { courseName } from '@major-vis/catalog-client'

const { computed } = Vue

export default {
  name: 'SchedulePicker',
  props: {
    active: { type: Boolean, default: false },
  },
  emits: ['edit', 'manage'],
  setup(props, { emit }) {
    const visibleSchedules = computed(() =>
      schedules.value.filter((s) => selectedScheduleIds.value.includes(s.id)),
    )
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
    // schedules: schedule name, course code+section, course name, instructor,
    // abbreviated days, and time. Offerings are ordered alphabetically by
    // prefix, then number, then section. With a single visible schedule the
    // file is named after that schedule.
    const downloadCsv = () => {
      const rows = [['Schedule', 'Course', 'Course name', 'Instructor', 'Days', 'Time']]
      for (const s of visibleSchedules.value) {
        const offerings = [...s.offerings].sort((a, b) => compareItems({ o: a }, { o: b }))
        for (const o of offerings) {
          const code = `${o.prefix} ${o.number}`
          rows.push([
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

    const edit = (id) => emit('edit', id)
    const manage = () => emit('manage')

    return {
      props,
      visibleSchedules,
      selectedScheduleIds,
      scheduleColorApplicable,
      filterActive,
      colorSchedules,
      setColorSchedules,
      downloadCsv,
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
      <button v-if="!selectedScheduleIds.length" class="filter-clear" @click="manage">No schedule selected — pick one</button>
    </div>
  `,
}
