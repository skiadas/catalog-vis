<template>
  <div class="schedule-table">
    <div class="schedule-table-tools">
      <label class="schedule-table-dept-label" for="schedule-table-dept">Department</label>
      <select id="schedule-table-dept" v-model="dept" class="search-input schedule-table-dept">
        <option value="">All departments</option>
        <option v-for="d in departments" :key="d" :value="d">
          {{ d }}{{ myDepartments.includes(d) ? ' (mine)' : '' }}
        </option>
      </select>
      <span class="schedule-table-count">{{ rows.length }} offering{{ rows.length === 1 ? '' : 's' }}</span>
      <span v-if="!editingScheduleId" class="schedule-table-hint"
        >Read-only — start editing to change offerings.</span
      >
      <span v-else-if="editingRole === 'suggest'" class="schedule-table-hint"
        >Suggesting — edits are limited to your departments and become proposals.</span
      >
      <button
        v-if="editingScheduleId"
        class="filter-btn primary schedule-table-add"
        @click="$emit('add-course')"
      >
        ＋ Add course
      </button>
    </div>

    <div v-if="!rows.length" class="schedule-table-empty">
      No {{ dept ? dept + ' ' : '' }}offerings in {{ TERM_LABELS[activeTerm] }}.
    </div>
    <div v-else class="schedule-table-scroll">
      <table class="courses-table schedule-table-grid">
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">Title</th>
            <th scope="col">Instructor</th>
            <th scope="col">Days</th>
            <th scope="col">Time</th>
            <th scope="col">Seats</th>
            <th scope="col">Core</th>
            <th scope="col">Schedule</th>
            <th scope="col" class="schedule-table-actions-head">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.key"
            class="schedule-table-row"
            :class="{ reference: reference(row), lab: row.o.lab }"
          >
            <td class="schedule-table-cell schedule-table-code">
              <button class="course-code-cell" @click="goScheduleCourse(row.code)">
                {{ offeringCodeLabel(row.o) }}
              </button>
              <span class="schedule-table-section" :class="{ lab: row.o.lab }">{{
                offeringSectionLabel(row.o)
              }}</span>
            </td>
            <ScheduleTableCell
              :value="row.o.title || ''"
              :display="effectiveTitle(row)"
              :editable="canEdit(row)"
              :locked="Boolean(row.o.lab)"
              label="Title"
              :edit-label="`Edit title of ${row.code}`"
              empty-text="Add title"
              @commit="(v) => commitField(row, 'title', v)"
            />
            <ScheduleTableCell
              :value="row.o.instructor || ''"
              :display="instructorsText(row.o)"
              :editable="canEdit(row)"
              label="Instructor"
              :edit-label="`Edit instructor of ${row.code}`"
              empty-text="Add instructor"
              @commit="(v) => commitField(row, 'instructor', v)"
            />
            <ScheduleTableCell
              :value="row.o.days || ''"
              :display="row.o.days || ''"
              :editable="canEdit(row)"
              label="Days"
              :edit-label="`Edit meeting days of ${row.code}`"
              @commit="(v) => commitField(row, 'days', v)"
            />
            <ScheduleTableCell
              :value="row.o.time || ''"
              :display="row.o.time ? formatTime(row.o.time) : ''"
              :editable="canEdit(row)"
              label="Time"
              :edit-label="`Edit meeting time of ${row.code}`"
              @commit="(v) => commitField(row, 'time', v)"
            />
            <ScheduleTableCell
              :value="row.o.seats != null ? row.o.seats : DEFAULT_SEATS"
              :display="String(row.o.seats != null ? row.o.seats : DEFAULT_SEATS)"
              :editable="canEdit(row)"
              type="number"
              label="Seats"
              :edit-label="`Edit seats of ${row.code}`"
              @commit="(v) => commitField(row, 'seats', v)"
            />
            <td class="schedule-table-cell schedule-table-core">{{ areasText(row.o) || '—' }}</td>
            <td class="schedule-table-cell schedule-table-source">{{ scheduleName(row.sid) }}</td>
            <td class="schedule-table-cell schedule-table-actions">
              <button
                v-if="canOpen(row)"
                class="schedule-table-action"
                :title="`Open ${row.code} in the editor`"
                :aria-label="`Open ${row.code} in the editor`"
                @click="openEditor(row)"
              >
                <IconPencil :size="13" :stroke-width="2.2" />
              </button>
              <button
                v-if="canRemove(row)"
                class="schedule-table-action danger"
                :title="`Remove ${row.code}`"
                :aria-label="`Remove ${row.code}`"
                @click="removeRow(row)"
              >
                <IconTrash2 :size="13" :stroke-width="2.2" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
// The table ("spreadsheet") view: one compact row per offering of the selected
// schedules' active term, with a department selector and in-place editing.
// When a session is active (owners edit; non-owners suggest) a row of a
// department the user is in becomes editable — its cells commit through
// `updateOffering`, so drafts, history, and cross-list rules come for free. A
// row's pencil opens the full course editor for labs/cross-listing/custom
// times; non-session schedules render dimmed as references.

import { goScheduleCourse } from '../router.js'
import { courseName } from '@major-vis/catalog-client'
import {
  DEFAULT_SEATS,
  TERM_LABELS,
  formatTime,
  instructorsOf,
  offeringCodeLabel,
  offeringItemKey,
  offeringSectionLabel,
} from '@major-vis/schedule-core'
import {
  activeTerm,
  canTouchOffering,
  coreReqsByCode,
  editingRole,
  editingScheduleId,
  instructorName,
  instructorValue,
  isReferenceItem,
  myDepartments,
  openCourseEdit,
  removeCourseFromSchedule,
  scheduleById,
  scheduleOfferings,
  updateOffering,
} from '../src/scheduleStore.js'
import {
  compareTableRows,
  departmentsInOfferings,
  inDepartment,
  parseDaysInput,
  parseSeatsInput,
  parseTimeInput,
} from '../src/scheduleTable.js'
import ScheduleTableCell from './ScheduleTableCell.vue'

import { computed, ref } from 'vue'

export default {
  name: 'ScheduleTable',
  components: { ScheduleTableCell },
  emits: ['add-course'],
  setup() {
    const dept = ref('')
    const departments = computed(() => departmentsInOfferings(scheduleOfferings.value))
    const rows = computed(() =>
      scheduleOfferings.value
        .filter((o) => inDepartment(o, dept.value))
        .map((o) => ({
          o,
          sid: o.$sid,
          code: `${o.prefix} ${o.number}`,
          key: offeringItemKey({ o, sid: o.$sid }),
        }))
        .sort((a, b) => compareTableRows(a.o, b.o)),
    )

    const scheduleName = (sid) => {
      const s = scheduleById(sid)
      return s ? s.name : ''
    }
    const reference = (row) => isReferenceItem({ o: row.o, sid: row.sid })
    // Editable only inside a session on the row's own schedule and within the
    // user's departments (`canTouchOffering` covers cross-list ownership).
    const canEdit = (row) =>
      editingScheduleId.value != null &&
      row.sid === editingScheduleId.value &&
      canTouchOffering(row.sid, row.o, 'edit')
    const canRemove = (row) =>
      editingScheduleId.value != null &&
      row.sid === editingScheduleId.value &&
      canTouchOffering(row.sid, row.o, 'remove')
    const canOpen = (row) => canEdit(row) || canRemove(row)

    const effectiveTitle = (row) => row.o.title || courseName(row.code)
    const instructorsText = (o) => instructorsOf(o).map(instructorName).join(', ')
    const areasText = (o) => {
      if (o.lab) return ''
      const own =
        o.coreReqs && o.coreReqs.length
          ? o.coreReqs
          : coreReqsByCode.value.get(`${o.prefix} ${o.number}`) || []
      return own.join(' ')
    }
    const curOf = (o) => ({
      prefix: o.prefix,
      number: o.number,
      section: o.section,
      lab: o.lab,
      labSeq: o.labSeq,
      id: o.id,
    })

    // Parse one cell's draft and commit it. Invalid or unchanged input is a
    // no-op (the cell reverts to the stored value on re-render).
    const commitField = (row, field, value) => {
      const o = row.o
      let changes = null
      if (field === 'title') {
        const title = String(value ?? '').trim()
        if (title === (o.title || '')) return
        changes = { title }
      } else if (field === 'instructor') {
        const instructor = instructorValue(String(value ?? '').trim())
        if (instructor === (o.instructor || '')) return
        changes = { instructor }
      } else if (field === 'days') {
        const days = parseDaysInput(value)
        if (days == null || days === (o.days || '')) return
        changes = { days }
      } else if (field === 'time') {
        const time = parseTimeInput(value)
        if (time == null || time === (o.time || '')) return
        changes = { time }
      } else if (field === 'seats') {
        const seats = parseSeatsInput(value)
        const current = o.seats != null ? o.seats : DEFAULT_SEATS
        if (seats == null || seats === current) return
        changes = { seats }
      }
      if (changes) updateOffering(row.sid, curOf(o), changes)
    }

    const openEditor = (row) => openCourseEdit({ o: row.o, code: row.code, sid: row.sid })
    const removeRow = (row) => {
      if (!canRemove(row)) return
      const label = `${offeringCodeLabel(row.o)} ${offeringSectionLabel(row.o)}`.trim()
      if (!window.confirm(`Remove ${label} from the schedule?`)) return
      removeCourseFromSchedule(row.sid, curOf(row.o))
    }

    return {
      dept,
      departments,
      rows,
      TERM_LABELS,
      DEFAULT_SEATS,
      activeTerm,
      editingRole,
      editingScheduleId,
      myDepartments,
      scheduleName,
      reference,
      canEdit,
      canRemove,
      canOpen,
      effectiveTitle,
      instructorsText,
      areasText,
      commitField,
      openEditor,
      removeRow,
      formatTime,
      offeringCodeLabel,
      offeringSectionLabel,
      goScheduleCourse,
    }
  },
}
</script>
