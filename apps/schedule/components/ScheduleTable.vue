<template>
  <div class="schedule-table">
    <div class="schedule-table-tools">
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

    <div class="schedule-table-filters">
      <div v-if="departments.length" class="schedule-table-filter-group">
        <button
          type="button"
          class="schedule-table-filter-toggle"
          :aria-expanded="deptOpen"
          @click="deptOpen = !deptOpen"
        >
          <span class="schedule-table-filter-label">Departments</span>
          <span class="schedule-table-filter-count">{{
            selectedDepts.length ? `${selectedDepts.length} selected` : departments.length
          }}</span>
        </button>
        <!-- Collapsed: keep the selected chips visible (click one to remove). -->
        <div
          v-if="!deptOpen && selectedDepts.length"
          class="schedule-table-filter-row schedule-table-chip-grid schedule-table-chip-grid-dept schedule-table-filter-selected"
        >
          <button
            v-for="d in selectedDepts"
            :key="d"
            type="button"
            class="filter-chip active"
            :style="{ backgroundColor: colorForDept(d) }"
            :aria-pressed="true"
            :title="d"
            @click="toggleDept(d)"
          >
            {{ d }}{{ myDepartments.includes(d) ? ' (mine)' : '' }}
          </button>
        </div>
        <div
          v-show="deptOpen"
          class="schedule-table-filter-row schedule-table-chip-grid schedule-table-chip-grid-dept"
        >
          <button
            v-for="d in departments"
            :key="d"
            type="button"
            class="filter-chip"
            :class="{ active: selectedDepts.includes(d) }"
            :style="selectedDepts.includes(d) ? { backgroundColor: colorForDept(d) } : {}"
            :aria-pressed="selectedDepts.includes(d)"
            :title="d"
            @click="toggleDept(d)"
          >
            {{ d }}{{ myDepartments.includes(d) ? ' (mine)' : '' }}
          </button>
        </div>
      </div>
      <div v-if="instructors.length" class="schedule-table-filter-group">
        <button
          type="button"
          class="schedule-table-filter-toggle"
          :aria-expanded="instrOpen"
          @click="instrOpen = !instrOpen"
        >
          <span class="schedule-table-filter-label">Instructors</span>
          <span class="schedule-table-filter-count">{{
            selectedInstructors.length ? `${selectedInstructors.length} selected` : instructors.length
          }}</span>
        </button>
        <!-- Collapsed: keep the selected chips visible (click one to remove). -->
        <div
          v-if="!instrOpen && selectedInstructors.length"
          class="schedule-table-filter-row schedule-table-chip-grid schedule-table-chip-grid-instr schedule-table-filter-selected"
        >
          <button
            v-for="n in selectedInstructors"
            :key="n"
            type="button"
            class="filter-chip active"
            :style="{ backgroundColor: colorForInstructor(n) }"
            :aria-pressed="true"
            :title="instructorName(n)"
            @click="toggleInstructor(n)"
          >
            {{ instructorName(n) }}
          </button>
        </div>
        <div
          v-show="instrOpen"
          class="schedule-table-filter-row schedule-table-chip-grid schedule-table-chip-grid-instr"
        >
          <button
            v-for="n in instructors"
            :key="n"
            type="button"
            class="filter-chip"
            :class="{ active: selectedInstructors.includes(n) }"
            :style="selectedInstructors.includes(n) ? { backgroundColor: colorForInstructor(n) } : {}"
            :aria-pressed="selectedInstructors.includes(n)"
            :title="instructorName(n)"
            @click="toggleInstructor(n)"
          >
            {{ instructorName(n) }}
          </button>
        </div>
      </div>
      <button
        v-if="selectedDepts.length || selectedInstructors.length"
        class="filter-clear"
        @click="clearFilters"
      >
        Clear
      </button>
    </div>

    <div v-if="!rows.length" class="schedule-table-empty">
      No {{ filterActive ? 'matching ' : '' }}offerings in {{ TERM_LABELS[activeTerm] }}.
    </div>
    <div v-else class="schedule-table-scroll">
      <table class="courses-table schedule-table-grid">
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">Title</th>
            <th scope="col">Instructor</th>
            <th scope="col">Meeting</th>
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
            :class="{
              reference: reference(row),
              lab: row.o.lab,
              proposed: proposed(row),
              removed: removed(row),
            }"
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

            <!-- Instructor: a combobox (directory + catalog roster + term). -->
            <td class="schedule-table-cell schedule-table-instructor">
              <div
                v-if="editingInstructorKey === row.key"
                ref="instructorSuggestEl"
                class="schedule-table-combo"
              >
                <input
                  ref="instructorInputEl"
                  class="schedule-table-input"
                  type="text"
                  autocomplete="off"
                  autocorrect="off"
                  autocapitalize="off"
                  spellcheck="false"
                  v-model="instructorText"
                  :aria-label="`Instructor of ${row.code}`"
                  @focus="instructorOpen = true"
                  @blur="onInstructorBlur"
                  @keydown.enter.prevent="commitInstructor"
                  @keydown.esc.prevent="cancelInstructor"
                />
                <div
                  v-if="instructorOpen"
                  class="course-picker-dropdown schedule-table-combo-dropdown is-anchored"
                  :style="instructorDropdownStyle"
                >
                  <button
                    v-for="opt in instructorSuggestions"
                    :key="opt.value"
                    type="button"
                    class="course-picker-option"
                    :title="opt.value"
                    :aria-label="opt.value === opt.label ? opt.label : `${opt.label} (${opt.value})`"
                    @mousedown.prevent
                    @click="pickInstructor(opt)"
                  >
                    <span class="planner-pick-code">{{ opt.label }}</span>
                  </button>
                  <div v-if="!instructorSuggestions.length" class="course-picker-empty">
                    No matches — keep typing.
                  </div>
                  <button
                    v-if="hasDeptPool"
                    type="button"
                    class="course-picker-scope link-toggle"
                    @mousedown.prevent
                    @click="toggleShowAllInstructors"
                  >
                    {{ showAllInstructors ? 'Limit to department' : 'Show all instructors' }}
                  </button>
                </div>
              </div>
              <button
                v-else-if="canEdit(row)"
                type="button"
                class="schedule-table-value schedule-table-value-edit"
                :class="{ 'is-empty': !instructorCellText(row.o) }"
                :aria-label="`Edit instructor of ${row.code}`"
                @click="beginInstructor(row)"
              >
                {{ instructorCellText(row.o) || 'Add instructor' }}
              </button>
              <span v-else class="schedule-table-value" :class="{ 'is-empty': !instructorCellText(row.o) }">{{
                instructorCellText(row.o) || '—'
              }}</span>
            </td>

            <!-- Meeting: a picker of the term's standard bands, plus custom. -->
            <td class="schedule-table-cell schedule-table-meeting">
              <template v-if="editingMeetingKey === row.key">
                <input
                  v-if="meetingCustom"
                  ref="meetingInputEl"
                  class="schedule-table-input"
                  type="text"
                  v-model="meetingCustomText"
                  placeholder="e.g. MW 8:00-9:10"
                  :aria-label="`Meeting of ${row.code}`"
                  @keydown.enter.prevent="commitMeetingCustom(row)"
                  @keydown.esc.prevent="cancelMeeting"
                  @blur="commitMeetingCustom(row)"
                />
                <select
                  v-else
                  ref="meetingSelectEl"
                  v-model="meetingValue"
                  class="schedule-table-input schedule-table-select"
                  :aria-label="`Meeting of ${row.code}`"
                  @change="applyMeeting(row)"
                  @keydown.esc.prevent="cancelMeeting"
                  @blur="onMeetingBlur(row)"
                >
                  <option value="">No meeting time</option>
                  <option v-for="b in bands" :key="b.days + '|' + b.time" :value="b.days + '|' + b.time">
                    {{ b.days }} {{ b.time }}
                  </option>
                  <option value="__custom">{{ customOptionLabel(row) }}</option>
                </select>
              </template>
              <button
                v-else-if="canEdit(row)"
                type="button"
                class="schedule-table-value schedule-table-value-edit"
                :class="{ 'is-empty': !row.o.days || !row.o.time }"
                :aria-label="`Edit meeting of ${row.code}`"
                @click="beginMeeting(row)"
              >
                {{ meetingText(row) }}
              </button>
              <span v-else class="schedule-table-value" :class="{ 'is-empty': !row.o.days || !row.o.time }">{{
                meetingText(row)
              }}</span>
            </td>

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
            <td class="schedule-table-cell schedule-table-source">{{ sourceText(row) }}</td>
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
// `updateOffering`, so drafts, history, and cross-list rules come for free. The
// instructor cell autocompletes from the same pools as the course editor
// (`src/instructorSuggest.js`); the meeting cell picks from the term's standard
// bands (with a custom fallback). A row's pencil opens the full course editor
// for labs/cross-listing; non-session schedules render dimmed as references.

import { goScheduleCourse } from '../router.js'
import { allCourses, courseName, programs } from '@major-vis/catalog-client'
import {
  DEFAULT_SEATS,
  TERM_LABELS,
  colorForDept,
  colorForInstructor,
  compareInstructors,
  formatTime,
  instructorsInSchedule,
  offeringCodeLabel,
  offeringItemKey,
  offeringSectionLabel,
} from '@major-vis/schedule-core'
import { buildFacultyAndEligible } from '@major-vis/schedule-core/generate'
import {
  activeTerm,
  canTouchOffering,
  coreReqsByCode,
  directoryIndex,
  editingRole,
  editingScheduleId,
  instructorName,
  instructorValue,
  isReferenceItem,
  myDepartments,
  openCourseEdit,
  overlayProposal,
  overlayRemoval,
  overlayTag,
  removeCourseFromSchedule,
  scheduleById,
  shownOfferings,
  shownSchedule,
  updateOffering,
} from '../src/scheduleStore.js'
import { buildInstructorOptions } from '../src/instructorSuggest.js'
import { defaultShowAll, instructorPoolFor } from '../src/instructorPool.js'
import { useAnchoredDropdown } from '../src/useAnchoredDropdown.js'
import {
  compareTableRows,
  departmentsInOfferings,
  leadInstructorText,
  parseMeetingInput,
  parseSeatsInput,
  rowMatchesFilters,
  standardBandFor,
  standardBands,
} from '../src/scheduleTable.js'
import ScheduleTableCell from './ScheduleTableCell.vue'

import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

export default {
  name: 'ScheduleTable',
  components: { ScheduleTableCell },
  emits: ['add-course'],
  setup() {
    const route = useRoute()
    const router = useRouter()
    // The table's filters (departments and instructors) are the route's `dept`
    // and `instructor` query params — multi-value, so `?dept=CS&dept=MAT`. They
    // survive a detour (a course link, say) and the Table tab, and a shared/
    // deep link restores them. The chips write them back; an external query
    // change updates the chips. Both watchers guard against each other.
    const queryList = (v) => (Array.isArray(v) ? v.map(String) : v == null || v === '' ? [] : [String(v)])
    const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
    const selectedDepts = ref(queryList(route.query.dept).map((d) => d.toUpperCase()))
    const selectedInstructors = ref(queryList(route.query.instructor))
    watch([selectedDepts, selectedInstructors], () => {
      const depts = selectedDepts.value
      const instructors = selectedInstructors.value
      const curDepts = queryList(route.query.dept).map((d) => d.toUpperCase())
      const curInstructors = queryList(route.query.instructor)
      if (sameList(depts, curDepts) && sameList(instructors, curInstructors)) return
      const query = { ...route.query }
      if (depts.length) query.dept = depts
      else delete query.dept
      if (instructors.length) query.instructor = instructors
      else delete query.instructor
      router.replace({ query })
    })
    watch(
      () => [route.query.dept, route.query.instructor],
      ([deptQ, instructorQ]) => {
        const depts = queryList(deptQ).map((d) => d.toUpperCase())
        const instructors = queryList(instructorQ)
        if (!sameList(depts, selectedDepts.value)) selectedDepts.value = depts
        if (!sameList(instructors, selectedInstructors.value)) selectedInstructors.value = instructors
      },
    )
    // The selectable chips, unioned with any URL-selected value so a
    // stale-but-valid selection stays toggleable (and clearable).
    const departments = computed(() => {
      const set = new Set(departmentsInOfferings(shownOfferings.value))
      for (const d of selectedDepts.value) set.add(d)
      return [...set].sort()
    })
    const instructors = computed(() => {
      const set = new Set(instructorsInSchedule(shownSchedule.value))
      for (const n of selectedInstructors.value) set.add(n)
      return [...set].sort(compareInstructors)
    })
    const filterActive = computed(
      () => selectedDepts.value.length > 0 || selectedInstructors.value.length > 0,
    )
    const toggleDept = (d) => {
      selectedDepts.value = selectedDepts.value.includes(d)
        ? selectedDepts.value.filter((x) => x !== d)
        : [...selectedDepts.value, d]
    }
    const toggleInstructor = (n) => {
      selectedInstructors.value = selectedInstructors.value.includes(n)
        ? selectedInstructors.value.filter((x) => x !== n)
        : [...selectedInstructors.value, n]
    }
    const clearFilters = () => {
      selectedDepts.value = []
      selectedInstructors.value = []
    }
    // Departments are few (expanded by default); instructors can be many, so
    // that row starts collapsed — except when a deep link already carries
    // instructor filters, which arrive expanded. The toggle then fully controls
    // visibility either way; a collapsed row still shows its "N selected" count.
    const deptOpen = ref(true)
    const instrOpen = ref(queryList(route.query.instructor).length > 0)
    const rows = computed(() =>
      shownOfferings.value
        .filter((o) => rowMatchesFilters(o, selectedDepts.value, selectedInstructors.value))
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
    // Pending-suggestion markers: a proposed row (dashed) or a live row a
    // proposal would take away (removal, or a move's source — struck through).
    // Proposed rows carry a `$prop` tag and a synthetic sid, so they never read
    // as editable or reference rows.
    const proposed = (row) => Boolean(overlayProposal(row.o))
    const removed = (row) => overlayRemoval(row.o)
    const sourceText = (row) => overlayTag(row.o) || scheduleName(row.sid)
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
    // The cell edits only the lead, so it displays only the lead (plus a `+N`
    // co-teacher count) — the pencil/editor manages the rest of the roster.
    const instructorCellText = (o) => leadInstructorText(o, instructorName)
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
    const rowByKey = (key) => rows.value.find((r) => r.key === key)
    // Template refs inside a `v-for` collect into an array; only the editing
    // row renders its input, so take the first element.
    const elOf = (r) => (Array.isArray(r.value) ? r.value[0] : r.value)

    // --- Title / seats (generic inline cells) ------------------------------
    const commitField = (row, field, value) => {
      const o = row.o
      let changes = null
      if (field === 'title') {
        const title = String(value ?? '').trim()
        if (title === (o.title || '')) return
        changes = { title }
      } else if (field === 'seats') {
        const seats = parseSeatsInput(value)
        const current = o.seats != null ? o.seats : DEFAULT_SEATS
        if (seats == null || seats === current) return
        changes = { seats }
      }
      if (changes) updateOffering(row.sid, curOf(o), changes)
    }

    // --- Instructor combobox ----------------------------------------------
    const facultyByPrefix = computed(
      () => buildFacultyAndEligible(programs.value, allCourses.value).facultyByPrefix,
    )
    const editingInstructorKey = ref(null)
    const instructorText = ref('')
    const instructorOpen = ref(false)
    const showAllInstructors = ref(false)
    const instructorInputEl = ref(null)
    const instructorSuggestEl = ref(null)
    const { style: instructorDropdownStyle } = useAnchoredDropdown(
      () => elOf(instructorInputEl),
      instructorOpen,
    )
    const instructorPools = computed(() => {
      const row = editingInstructorKey.value == null ? null : rowByKey(editingInstructorKey.value)
      return buildInstructorOptions({
        prefix: row ? row.o.prefix : '',
        facultyByPrefix: facultyByPrefix.value,
        termOfferings: shownOfferings.value,
        directoryIndex: directoryIndex.value,
      })
    })
    const hasDeptPool = computed(() => instructorPools.value.deptOptions.length > 0)
    const instructorSuggestions = computed(() => {
      if (!instructorOpen.value) return []
      const pool = instructorPoolFor({
        deptOptions: instructorPools.value.deptOptions,
        allOptions: instructorPools.value.allOptions,
        showAll: showAllInstructors.value,
      })
      const token = instructorText.value.trim().toLowerCase()
      const matched = token
        ? pool.filter(
            (e) => e.label.toLowerCase().startsWith(token) || e.value.toLowerCase().startsWith(token),
          )
        : pool
      return matched.slice(0, 8)
    })
    const toggleShowAllInstructors = () => {
      showAllInstructors.value = !showAllInstructors.value
    }
    const beginInstructor = (row) => {
      editingInstructorKey.value = row.key
      instructorText.value = row.o.instructor ? instructorName(row.o.instructor) : ''
      instructorOpen.value = true
      // Default the scope from the row's instructor (an outside name opens the
      // all pool); a late-loading catalog/directory is handled by the pool
      // fallback in `instructorPoolFor`.
      showAllInstructors.value = defaultShowAll(
        instructorValue(row.o.instructor),
        instructorPools.value.deptOptions,
      )
      nextTick(() => {
        const el = elOf(instructorInputEl)
        if (el && el.focus) el.focus()
      })
    }
    const commitInstructor = () => {
      const key = editingInstructorKey.value
      if (key == null) return
      const row = rowByKey(key)
      const text = instructorText.value.trim()
      editingInstructorKey.value = null
      instructorOpen.value = false
      if (!row) return
      const instructor = instructorValue(text)
      if (instructor === (row.o.instructor || '')) return
      updateOffering(row.sid, curOf(row.o), { instructor })
    }
    const cancelInstructor = () => {
      editingInstructorKey.value = null
      instructorOpen.value = false
    }
    const pickInstructor = (entry) => {
      instructorText.value = entry.label
      commitInstructor()
    }
    const onInstructorBlur = (e) => {
      const next = e.relatedTarget
      if (next && elOf(instructorSuggestEl) && elOf(instructorSuggestEl).contains(next)) return
      commitInstructor()
    }

    // --- Meeting picker ----------------------------------------------------
    const bands = computed(() => standardBands(activeTerm.value))
    const editingMeetingKey = ref(null)
    const meetingCustom = ref(false)
    const meetingValue = ref('')
    const meetingCustomText = ref('')
    const meetingSelectEl = ref(null)
    const meetingInputEl = ref(null)
    const meetingText = (row) =>
      row.o.days && row.o.time ? `${row.o.days} · ${formatTime(row.o.time)}` : 'No meeting time'
    const meetingSelectValue = (row) => {
      if (!row.o.days || !row.o.time) return ''
      const band = standardBandFor(bands.value, row.o.days, row.o.time)
      return band ? `${band.days}|${band.time}` : '__custom'
    }
    // The custom option's label names the row's off-pattern meeting, so opening
    // the picker on a custom row reads as that value rather than a blank
    // "Custom…" — and Esc / clicking away cancels back to it.
    const customOptionLabel = (row) =>
      meetingSelectValue(row) === '__custom'
        ? `Custom: ${row.o.days || ''} ${row.o.time || ''}`.trim()
        : 'Custom…'
    const beginMeeting = (row) => {
      editingMeetingKey.value = row.key
      meetingCustom.value = false
      meetingValue.value = meetingSelectValue(row)
      nextTick(() => {
        const el = elOf(meetingSelectEl)
        if (el && el.focus) el.focus()
      })
    }
    const commitMeeting = (row, changes) => {
      editingMeetingKey.value = null
      meetingCustom.value = false
      if (!changes) return
      if (changes.days === (row.o.days || '') && changes.time === (row.o.time || '')) return
      updateOffering(row.sid, curOf(row.o), changes)
    }
    const applyMeeting = (row) => {
      const value = meetingValue.value
      if (value === '__custom') {
        meetingCustom.value = true
        meetingCustomText.value = `${row.o.days || ''} ${row.o.time || ''}`.trim()
        nextTick(() => {
          const el = elOf(meetingInputEl)
          if (el && el.focus) el.focus()
        })
        return
      }
      if (!value) {
        commitMeeting(row, { days: '', time: '' })
        return
      }
      const [days, time] = value.split('|')
      commitMeeting(row, { days, time })
    }
    const commitMeetingCustom = (row) => {
      const parsed = parseMeetingInput(meetingCustomText.value)
      commitMeeting(row, parsed)
    }
    const cancelMeeting = () => {
      editingMeetingKey.value = null
      meetingCustom.value = false
    }
    // Clicking away without choosing cancels (its own Esc path handles the
    // keyboard). Deferred a tick so an option pick's `change` lands first —
    // that commits and clears the editing key, making this a no-op.
    const onMeetingBlur = (row) => {
      nextTick(() => {
        if (editingMeetingKey.value === row.key && !meetingCustom.value) cancelMeeting()
      })
    }

    const openEditor = (row) => openCourseEdit({ o: row.o, code: row.code, sid: row.sid })
    const removeRow = (row) => {
      if (!canRemove(row)) return
      const label = `${offeringCodeLabel(row.o)} ${offeringSectionLabel(row.o)}`.trim()
      if (!window.confirm(`Remove ${label} from the schedule?`)) return
      removeCourseFromSchedule(row.sid, curOf(row.o))
    }

    return {
      departments,
      instructors,
      selectedDepts,
      selectedInstructors,
      filterActive,
      deptOpen,
      instrOpen,
      toggleDept,
      toggleInstructor,
      clearFilters,
      colorForDept,
      colorForInstructor,
      rows,
      bands,
      TERM_LABELS,
      DEFAULT_SEATS,
      activeTerm,
      editingRole,
      editingScheduleId,
      myDepartments,
      proposed,
      removed,
      sourceText,
      reference,
      canEdit,
      canRemove,
      canOpen,
      effectiveTitle,
      instructorCellText,
      instructorName,
      areasText,
      commitField,
      editingInstructorKey,
      instructorText,
      instructorOpen,
      instructorDropdownStyle,
      showAllInstructors,
      hasDeptPool,
      toggleShowAllInstructors,
      instructorInputEl,
      instructorSuggestEl,
      instructorSuggestions,
      beginInstructor,
      commitInstructor,
      cancelInstructor,
      pickInstructor,
      onInstructorBlur,
      editingMeetingKey,
      meetingCustom,
      meetingValue,
      meetingCustomText,
      meetingSelectEl,
      meetingInputEl,
      meetingText,
      customOptionLabel,
      beginMeeting,
      applyMeeting,
      commitMeetingCustom,
      cancelMeeting,
      onMeetingBlur,
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
