import { route } from '../router.js'
import { goScheduleGrid, goScheduleCourse, goScheduleInstructor } from '../router.js'
import { allCourses } from '@major-vis/catalog-client'
import {
  selectedDepartments,
  selectedInstructors,
  filterMode,
  generateSchedule,
  schedule,
  scheduleOfferings,
  schedules,
  selectedScheduleIds,
  toggleSchedule,
  deleteSchedule,
  renameSchedule,
  duplicateSchedule,
  colorSchedules,
  setColorSchedules,
  editingScheduleId,
  editingSchedule,
  setEditingSchedule,
  addCourseToSchedule,
  openCourseEdit,
  courseEditTarget,
  closeCourseEdit,
} from '../src/scheduleStore.js'
import {
  departmentsInSchedule,
  instructorsInSchedule,
  colorForDept,
  colorForInstructor,
  colorForSchedule,
  compareCodes,
  compareItems,
} from '@major-vis/schedule-core'
import ScheduleGrid from './ScheduleGrid.js'
import ScheduleDay from './ScheduleDay.js'
import ScheduleSlot from './ScheduleSlot.js'
import ScheduleCourse from './ScheduleCourse.js'
import ScheduleInstructor from './ScheduleInstructor.js'
import ScheduleCourseEdit from './ScheduleCourseEdit.js'

const { computed, ref } = Vue

export default {
  name: 'ScheduleApp',
  components: {
    ScheduleGrid,
    ScheduleDay,
    ScheduleSlot,
    ScheduleCourse,
    ScheduleInstructor,
    ScheduleCourseEdit,
  },
  setup() {
    const view = computed(() => route.value.params.scheduleView || 'grid')
    const sortedCourses = computed(() => {
      if (!schedule.value) return []
      return Object.keys(schedule.value.byCourse).sort()
    })
    const selectedCode = computed(() => route.value.params.code || '')

    const courseQuery = ref('')
    const courseOpen = ref(false)
    const courseResults = computed(() => {
      const q = courseQuery.value.trim().toLowerCase()
      const qn = q.replace(/\s+/g, '')
      let list = Object.keys(schedule.value?.byCourse || {}).sort()
      if (q) {
        list = list.filter(
          (code) =>
            code.replace(/\s+/g, '').toLowerCase().includes(qn) ||
            (allCourses.value[code]?.course_name || '').toLowerCase().includes(q),
        )
      }
      return list
    })
    const courseName = (code) => (allCourses.value[code] ? allCourses.value[code].course_name : '')
    const pickCourse = (code) => {
      courseQuery.value = ''
      courseOpen.value = false
      goScheduleCourse(code)
    }

    const showHelp = ref(false)
    const toggleHelp = () => {
      showHelp.value = !showHelp.value
    }

    const showSchedules = ref(false)
    const showCreate = ref(false)
    const newKind = ref('empty')
    const newName = ref('')
    const newDept = ref('')
    const visibleSchedules = computed(() =>
      schedules.value.filter((s) => selectedScheduleIds.value.includes(s.id)),
    )
    const manageQuery = ref('')
    const filteredSchedules = computed(() => {
      const q = manageQuery.value.trim().toLowerCase()
      if (!q) return schedules.value
      return schedules.value.filter((s) => s.name.toLowerCase().includes(q))
    })
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
      generateSchedule({ mode, dept, name: newName.value })
      newName.value = ''
      newKind.value = 'empty'
      showCreate.value = false
    }
    const removeSchedule = (id) => deleteSchedule(id)
    // Duplicates a schedule, then drops into edit mode on the copy (which is
    // auto-selected by `duplicateSchedule`).
    const duplicateAndEdit = (id) => {
      const newId = duplicateSchedule(id)
      if (newId) enterEdit(newId)
    }

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
            allCourses.value[code]?.course_name || '',
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

    const editingId = editingScheduleId
    const editingName = computed(() => (editingSchedule.value ? editingSchedule.value.name : ''))
    const nameDraft = ref('')
    const enterEdit = (id) => {
      setEditingSchedule(id)
      nameDraft.value = editingSchedule.value ? editingSchedule.value.name : ''
      showSchedules.value = false
      if (view.value !== 'grid') goScheduleGrid()
    }
    const exitEdit = () => {
      setEditingSchedule(null)
    }
    // Renames the edited schedule from the inline input (on Enter or blur).
    const commitRename = () => {
      const s = editingSchedule.value
      if (!s) return
      if (nameDraft.value.trim() && nameDraft.value.trim() !== s.name) {
        renameSchedule(s.id, nameDraft.value)
      } else {
        nameDraft.value = s.name
      }
    }

    const showAddCourse = ref(false)
    const addCourseQuery = ref('')
    const allCatalogCourses = computed(() => Object.keys(allCourses.value).sort(compareCodes))
    const addCourseResults = computed(() => {
      const q = addCourseQuery.value.trim().toLowerCase()
      const qn = q.replace(/\s+/g, '')
      let list = allCatalogCourses.value
      if (q) {
        list = list.filter(
          (code) =>
            code.replace(/\s+/g, '').toLowerCase().includes(qn) ||
            (allCourses.value[code]?.course_name || '').toLowerCase().includes(q),
        )
      }
      return list
    })
    // Adds the picked catalog course to the edited schedule on its default slot,
    // then opens its course editor for further customization.
    const addCourse = (code) => {
      const item = addCourseToSchedule(editingId.value, code)
      showAddCourse.value = false
      addCourseQuery.value = ''
      if (item) openCourseEdit(item)
    }

    const depts = computed(() => departmentsInSchedule(schedule.value))
    const instructors = computed(() => instructorsInSchedule(schedule.value))
    const toggleDept = (prefix) => {
      const i = selectedDepartments.value.indexOf(prefix)
      if (i < 0) selectedDepartments.value = [...selectedDepartments.value, prefix]
      else selectedDepartments.value = selectedDepartments.value.filter((p) => p !== prefix)
    }
    const clearDepts = () => {
      selectedDepartments.value = []
    }
    const toggleInstructor = (name) => {
      const i = selectedInstructors.value.indexOf(name)
      if (i < 0) selectedInstructors.value = [...selectedInstructors.value, name]
      else selectedInstructors.value = selectedInstructors.value.filter((n) => n !== name)
    }
    const clearInstructors = () => {
      selectedInstructors.value = []
    }
    const showFilter = computed(() => ['grid', 'day', 'slot'].includes(view.value))

    const filterActive = computed(
      () =>
        (filterMode.value === 'dept' && selectedDepartments.value.length > 0) ||
        (filterMode.value === 'instructor' && selectedInstructors.value.length > 0),
    )

    const scheduleColorApplicable = computed(
      () => selectedScheduleIds.value.length > 0 && !filterActive.value,
    )

    return {
      view,
      sortedCourses,
      selectedCode,
      courseQuery,
      courseOpen,
      courseResults,
      courseName,
      pickCourse,
      schedule,
      scheduleOfferings,
      selectedDepartments,
      selectedInstructors,
      filterMode,
      schedules,
      selectedScheduleIds,
      toggleSchedule,
      deleteSchedule,
      generateSchedule,
      visibleSchedules,
      scheduleColorApplicable,
      filterActive,
      editingId,
      editingName,
      nameDraft,
      enterEdit,
      exitEdit,
      commitRename,
      showAddCourse,
      addCourseQuery,
      allCatalogCourses,
      addCourseResults,
      addCourse,
      courseEditTarget,
      closeCourseEdit,
      manageQuery,
      filteredSchedules,
      showSchedules,
      showCreate,
      newKind,
      newName,
      newDept,
      deptOptions,
      openCreate,
      doCreate,
      removeSchedule,
      duplicateAndEdit,
      downloadCsv,
      colorForSchedule,
      depts,
      instructors,
      toggleDept,
      clearDepts,
      toggleInstructor,
      clearInstructors,
      showFilter,
      colorSchedules,
      setColorSchedules,
      showHelp,
      toggleHelp,
      colorForDept,
      colorForInstructor,
      goScheduleGrid,
      goScheduleCourse,
      goScheduleInstructor,
    }
  },
  template: `
    <div v-if="schedule">
      <button class="back-btn" @click="goScheduleGrid()">← Schedule Overview</button>

      <div class="schedule-header">
        <div class="schedule-title-row">
          <span class="section-title">Schedule Visualization</span>
          <span class="schedule-sub">
            {{ scheduleOfferings.length }} offerings ·
            {{ Object.keys(schedule.byCourse).length }} distinct courses ·
            {{ Object.keys(schedule.byInstructor).length }} instructors
          </span>
          <button class="schedule-help-toggle" title="How to use this page" @click="toggleHelp">?</button>
        </div>

        <div class="schedule-note">
          These are made-up, illustrative schedules. They do not reflect actual course offerings or meeting times. Pick one or more to display at once; the "Color by schedule" toggle color-codes each schedule's courses unless a department/instructor filter is active.
        </div>

        <div class="schedule-picker">
          <button class="filter-btn" :class="{ active: showSchedules }" @click="showSchedules = true">
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
              @click.stop="enterEdit(s.id)"
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
          <button v-if="!selectedScheduleIds.length" class="filter-clear" @click="showSchedules = true">No schedule selected — pick one</button>
        </div>

        <div class="schedule-toolbar">
          <div class="schedule-tabs">
            <button class="filter-btn" :class="{ active: view === 'grid' }" @click="goScheduleGrid()">Grid</button>
            <button
              class="filter-btn"
              :class="{ active: view === 'course' }"
              @click="goScheduleCourse(selectedCode || sortedCourses[0])"
            >Course conflicts</button>
            <button
              class="filter-btn"
              :class="{ active: view === 'instructor' }"
              @click="goScheduleInstructor(Object.keys(schedule.byInstructor)[0])"
            >Instructor Schedule</button>
          </div>

          <div class="filter-mode" v-if="showFilter">
            <span class="filter-mode-label">Filters:</span>
            <button class="filter-btn" :class="{ active: filterMode === 'dept' }" @click="filterMode = 'dept'">Departments</button>
            <button class="filter-btn" :class="{ active: filterMode === 'instructor' }" @click="filterMode = 'instructor'">Instructors</button>
          </div>
        </div>

        <div class="schedule-edit-bar" v-if="editingId">
          <span class="schedule-edit-label">Edit mode:
            <input
              class="schedule-edit-name"
              v-model="nameDraft"
              @blur="commitRename"
              @keydown.enter="commitRename"
              aria-label="Schedule name"
            />
          </span>
          <button class="filter-btn primary" @click="showAddCourse = true">＋ Add course</button>
          <span class="schedule-edit-hint" v-if="view !== 'grid'">Switch to the grid view to click a course's edit icon or drag it onto a time slot.</span>
          <span class="schedule-edit-hint" v-else>Click a course's edit icon to change its settings, or drag it onto a time slot to move it.</span>
          <button class="filter-btn" @click="exitEdit">Done</button>
        </div>

        <div class="course-picker" v-if="view === 'course'">
          <label for="schedule-course-search">Course:</label>
          <div class="course-picker-wrap">
            <input
              id="schedule-course-search"
              class="search-input"
              type="search"
              placeholder="Search code or name…"
              v-model="courseQuery"
              @focus="courseOpen = true"
              @blur="courseOpen = false"
            />
            <div v-if="courseOpen" class="course-picker-dropdown">
              <button
                v-for="code in courseResults"
                :key="code"
                class="course-picker-option"
                :class="{ active: code === selectedCode }"
                @mousedown.prevent="pickCourse(code)"
              >
                <span class="planner-pick-code">{{ code }}</span>
                <span class="planner-pick-name">{{ courseName(code) }}</span>
              </button>
              <div v-if="!courseResults.length" class="course-picker-empty">No courses match.</div>
            </div>
          </div>
        </div>
      </div>

        <div class="filter-panel" v-if="showFilter && filterMode === 'dept'">
          <span class="filter-label">Departments:</span>
          <span
            v-for="d in depts"
            :key="d"
            class="filter-chip"
            :class="{ on: selectedDepartments.includes(d) }"
            :style="selectedDepartments.includes(d) ? { backgroundColor: colorForDept(d) } : {}"
            @click="toggleDept(d)"
          >{{ d }}</span>
          <button v-if="selectedDepartments.length" class="filter-clear" @click="clearDepts">Clear</button>
        </div>

        <div class="filter-panel" v-if="showFilter && filterMode === 'instructor'">
          <span class="filter-label">Instructors:</span>
          <span
            v-for="i in instructors"
            :key="i"
            class="filter-chip"
            :class="{ on: selectedInstructors.includes(i) }"
            :style="selectedInstructors.includes(i) ? { backgroundColor: colorForInstructor(i) } : {}"
            @click="toggleInstructor(i)"
          >{{ i }}</span>
          <button v-if="selectedInstructors.length" class="filter-clear" @click="clearInstructors">Clear</button>
        </div>

        <div v-if="!selectedScheduleIds.length" class="empty-state">
        <p v-if="schedules.length">{{ schedules.length }} schedule{{ schedules.length !== 1 ? 's' : '' }} available but none selected.</p>
        <p v-else><strong>No schedules yet.</strong> Create one via "Your schedules" → "New schedule".</p>
      </div>
        <template v-else>
          <ScheduleGrid v-if="view === 'grid'" />
          <ScheduleDay v-else-if="view === 'day'" />
          <ScheduleSlot v-else-if="view === 'slot'" />
          <ScheduleCourse v-else-if="view === 'course'" />
          <ScheduleInstructor v-else-if="view === 'instructor'" />
        </template>

        <ScheduleCourseEdit
          v-if="courseEditTarget && editingId"
          :schedule-id="editingId"
          :offering="courseEditTarget"
          @close="closeCourseEdit"
        />
      </div>
    <div v-else class="loading">Loading schedule...</div>

    <div v-if="showHelp" class="modal-overlay" @click.self="toggleHelp">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-help-title">
        <div class="modal-head">
          <h3 id="schedule-help-title">Using the Schedule page</h3>
          <button class="modal-close" @click="toggleHelp" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="modal-intro">
            This is a made-up, illustrative schedule. Browse it by view with the tabs, and drill down by clicking.
            The <strong>Department</strong> / <strong>Instructor</strong> chips filter which offerings are highlighted.
          </p>

          <div class="help-section">
            <h4>Grid view</h4>
            <p>Shows the whole week as colored blocks. Switch between the <em>Departments</em> and <em>Instructors</em>
            filter modes, then click a chip to highlight matching offerings. Click a time block to open that day and
            slot, and click an individual course chip to jump to its conflicts.</p>
          </div>

          <div class="help-section">
            <h4>Day &amp; slot views</h4>
            <p>Click any offering (or time slot) in the grid to drill into a single day and then a specific slot.
            Each slot lists its offerings, color-coded if a filter is active.</p>
          </div>

          <div class="help-section">
            <h4>Course conflicts</h4>
            <p>Pick a course from the dropdown. It lists every scheduled section (days, time, instructor) and flags other
            courses whose times overlap, so you can see what would collide in a student schedule.</p>
          </div>

          <div class="help-section">
            <h4>Instructor view</h4>
            <p>Select an instructor to see their weekly timetable. Any double-bookings (two courses at the same time)
            are shown as alerts at the top.</p>
          </div>

          <div class="help-section">
            <h4>Tips</h4>
            <ul>
              <li>Use <strong>Clear</strong> to reset the active filter.</li>
              <li>The tabs (Grid / Course conflicts / Instructor) always return you to the top-level views.</li>
              <li>Everything here is a synthetic sample, not the real catalog.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showSchedules" class="modal-overlay" @click.self="showSchedules = false">
      <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="schedule-manage-title">
        <div class="modal-head">
          <h3 id="schedule-manage-title">Your schedules</h3>
          <button class="modal-close" @click="showSchedules = false" aria-label="Close">×</button>
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
                <div class="schedule-manage-meta">{{ s.offerings.length }} offerings</div>
              </div>
              <button
                class="schedule-manage-eye"
                :aria-label="(selectedScheduleIds.includes(s.id) ? 'Hide' : 'Show') + ' ' + s.name"
                :class="{ on: selectedScheduleIds.includes(s.id) }"
                :title="(selectedScheduleIds.includes(s.id) ? 'Hide' : 'Show') + ' ' + s.name"
                @click="toggleSchedule(s.id)"
              >
                <svg v-if="selectedScheduleIds.includes(s.id)" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
              <button
                class="schedule-manage-icon"
                :class="{ active: editingId === s.id }"
                :aria-label="'Edit ' + s.name"
                :title="'Edit ' + s.name"
                @click="enterEdit(s.id)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
              </button>
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

    <div v-if="showAddCourse" class="modal-overlay" @click.self="showAddCourse = false">
      <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="schedule-add-course-title">
        <div class="modal-head">
          <h3 id="schedule-add-course-title">Add a course to {{ editingName }}</h3>
          <button class="modal-close" @click="showAddCourse = false" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="modal-intro">
            Pick a catalog course to add it to this schedule in its default slot — its edit window opens next
            so you can customize it right away.
          </p>
          <input
            class="search-input schedule-add-search"
            type="search"
            placeholder="Search code or name…"
            v-model="addCourseQuery"
          />
          <div class="schedule-add-list">
            <button
              v-for="code in addCourseResults"
              :key="code"
              class="course-picker-option schedule-add-option"
              @click="addCourse(code)"
            >
              <span class="planner-pick-code">{{ code }}</span>
              <span class="planner-pick-name">{{ courseName(code) }}</span>
            </button>
            <div v-if="!addCourseResults.length" class="course-picker-empty">No courses match.</div>
          </div>
        </div>
      </div>
    </div>
  `,
}
