<template>
  <div v-if="schedule">
    <SchedulePicker v-if="!isManagePage" @edit="enterEdit" @manage="goManage()" />

    <div class="schedule-toolbar" v-if="!isManagePage">
      <div class="seg" role="group" aria-label="View">
        <button
          class="seg-btn"
          :class="{ active: view === 'grid' }"
          :aria-pressed="view === 'grid'"
          @click="goScheduleGrid()"
        >
          Grid
        </button>
        <button
          class="seg-btn"
          :class="{ active: view === 'course' }"
          :aria-pressed="view === 'course'"
          @click="goScheduleCourse(selectedCode || sortedCourses[0])"
        >
          Course conflicts
        </button>
        <button
          class="seg-btn"
          :class="{ active: view === 'instructor' }"
          :aria-pressed="view === 'instructor'"
          @click="goScheduleInstructor(Object.keys(schedule.byInstructor)[0])"
        >
          Instructor
        </button>
      </div>

      <div class="seg" role="group" aria-label="Term">
        <button
          v-for="t in TERM_KEYS"
          :key="t"
          class="seg-btn"
          :class="{ active: activeTerm === t }"
          :aria-pressed="activeTerm === t"
          @click="setActiveTerm(t)"
        >
          {{ TERM_LABELS[t] }}
        </button>
      </div>

      <div class="schedule-toolbar-right">
        <div class="filter-mode" v-if="view === 'grid'">
          <div class="seg" role="group" aria-label="Show blocks">
            <button
              class="seg-btn"
              :class="{ active: blockMode === 'all' }"
              :aria-pressed="blockMode === 'all'"
              title="Show standard-slot bars and custom rails"
              @click="setBlockMode('all')"
            >
              All
            </button>
            <button
              class="seg-btn"
              :class="{ active: blockMode === 'normal' }"
              :aria-pressed="blockMode === 'normal'"
              title="Show standard-slot blocks only"
              @click="setBlockMode('normal')"
            >
              Normal
            </button>
            <button
              class="seg-btn"
              :class="{ active: blockMode === 'custom' }"
              :aria-pressed="blockMode === 'custom'"
              title="Show off-slot custom blocks only"
              @click="setBlockMode('custom')"
            >
              Custom
            </button>
          </div>
        </div>
        <div class="filter-mode" v-if="showFilter">
          <div class="seg" role="group" aria-label="Filter by">
            <button
              class="seg-btn"
              :class="{ active: filterMode === 'dept' && filterPanelOpen }"
              :aria-pressed="filterMode === 'dept'"
              @click="pickFilter('dept')"
            >
              Departments<span v-if="deptFilterCount" class="filter-count">({{ deptFilterCount }})</span>
            </button>
            <button
              class="seg-btn"
              :class="{ active: filterMode === 'instructor' && filterPanelOpen }"
              :aria-pressed="filterMode === 'instructor'"
              @click="pickFilter('instructor')"
            >
              Instructors<span v-if="instructorFilterCount" class="filter-count"
                >({{ instructorFilterCount }})</span
              >
            </button>
          </div>
          <button
            v-if="!filterPanelOpen && (deptFilterCount || instructorFilterCount)"
            class="filter-clear"
            @click="clearActiveFilters"
          >
            Clear
          </button>
          <button
            v-if="pendingSuggestionsForTerm.length"
            class="filter-btn schedule-proposals-toggle"
            :class="{ active: showPendingSuggestions }"
            :aria-pressed="showPendingSuggestions"
            @click="setShowPendingSuggestions(!showPendingSuggestions)"
          >
            Show proposals
          </button>
        </div>

        <button
          v-if="suggestionsScheduleId"
          class="filter-btn schedule-suggestions-btn"
          @click="showSuggestions = true"
        >
          Suggested changes
        </button>
      </div>
    </div>

    <div class="schedule-edit-bar" v-if="editingId && !isManagePage">
      <span class="schedule-edit-label"
        >{{ editingRole === 'suggest' ? 'Suggestion mode:' : 'Edit mode:' }}
        <input
          class="schedule-edit-name"
          v-model="nameDraft"
          @blur="commitRename"
          @keydown.enter="commitRename"
          aria-label="Schedule name"
        />
      </span>
      <button class="filter-btn primary" @click="showAddCourse = true">＋ Add course</button>
      <span class="schedule-edit-hint" v-if="editingRole === 'suggest'"
        >Changes are collected into a proposal for the owner to approve — nothing is written to the schedule
        until then.</span
      >
      <span class="schedule-edit-hint" v-else
        >Click a course's edit icon to change its settings, or drag it by its grip onto a time slot to move
        it.</span
      >
      <button
        class="filter-btn schedule-history-btn"
        :class="{ active: showHistory }"
        :aria-pressed="showHistory"
        @click="showHistory = true"
      >
        History{{ historyEntries.length ? ` (${historyEntries.length})` : '' }}
      </button>
      <button
        v-if="editingRole === 'suggest'"
        class="filter-btn schedule-suggestions-btn"
        :class="{ active: showSuggestions }"
        :aria-pressed="showSuggestions"
        @click="showSuggestions = true"
      >
        {{ editingDraft && editingDraft.dirty ? 'Propose changes ●' : 'Propose changes' }}
      </button>
      <button class="filter-btn" @click="exitEdit">Done</button>
    </div>

    <div class="course-picker" v-if="view === 'course'">
      <label for="schedule-course-search">Course:</label>
      <div class="course-picker-wrap" ref="coursePickerEl">
        <input
          id="schedule-course-search"
          class="search-input"
          type="search"
          placeholder="Search code or name…"
          v-model="courseQuery"
          @focus="courseOpen = true"
          @blur="onCourseBlur"
          @keydown.esc="courseOpen = false"
        />
        <div v-if="courseOpen" class="course-picker-dropdown">
          <button
            v-for="code in courseResults"
            :key="code"
            class="course-picker-option"
            :class="{ active: code === selectedCode }"
            :aria-current="code === selectedCode ? 'true' : undefined"
            @mousedown.prevent="pickCourse(code)"
            @click="pickCourse(code)"
          >
            <span class="planner-pick-code">{{ code }}</span>
            <span class="planner-pick-name">{{ courseName(code) }}</span>
          </button>
          <div v-if="!courseResults.length" class="course-picker-empty">No courses match.</div>
        </div>
      </div>
    </div>

    <ScheduleFilters v-if="!isManagePage" :view="view" />

    <ScheduleManage v-if="isManagePage" @close="goBackOrGrid" @edit="enterEdit" @access="goAccess" />
    <div v-else-if="!selectedScheduleIds.length" class="empty-state">
      <p v-if="schedules.length">
        {{ schedules.length }} schedule{{ schedules.length !== 1 ? 's' : '' }} available but none selected.
        <span v-if="remote"
          >The collection is shared — schedules you didn't create belong to other users and accept suggested
          changes, not direct edits.</span
        >
      </p>
      <p v-else>
        <strong>No schedules yet.</strong> Create one via "Your schedules" → "New schedule"
        <span v-if="remote">, or search shared schedules there.</span>
      </p>
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

    <ScheduleAccess v-if="overlay === 'access'" :schedule-id="accessScheduleId" @close="goBackOrGrid" />
  </div>
  <div v-else class="loading" role="status">Loading schedule...</div>

  <ScheduleAddCourse :is-open="showAddCourse" @close="showAddCourse = false" />
  <SuggestedChanges
    :is-open="showSuggestions"
    :schedule-id="suggestionsScheduleId"
    @close="showSuggestions = false"
  />
  <ScheduleHistory :is-open="showHistory" @close="showHistory = false" @edit-course="onEditCourse" />
</template>

<script>
// Schedule page orchestrator: renders the header, the schedule-selection
// picker, the view tabs, the edit bar, and whichever sub-view is active, and
// wires the extracted modals (help / manage / add-course). Sub-views and
// modals read the schedule store directly; picker/filters take the pieces of
// view state they need as props.

import { useRoute } from 'vue-router'
import {
  goScheduleGrid,
  goScheduleCourse,
  goScheduleInstructor,
  goManage,
  goAccess,
  goBackOrGrid,
} from '../router.js'
import { courseName } from '@major-vis/catalog-client'
import {
  filterMode,
  filterPanelOpen,
  selectedDepartments,
  selectedInstructors,
  schedule,
  schedules,
  selectedScheduleIds,
  editingScheduleId,
  editingRole,
  editingSchedule,
  editingDraft,
  setEditingSchedule,
  clearDraft,
  renameSchedule,
  activeTerm,
  setActiveTerm,
  showPendingSuggestions,
  setShowPendingSuggestions,
  pendingSuggestionsForTerm,
  blockMode,
  setBlockMode,
  courseEditTarget,
  closeCourseEdit,
  historyEntries,
  cancelLatest,
  jumpToEdit,
  remote,
} from '../src/scheduleStore.js'
import { TERM_KEYS, TERM_LABELS } from '@major-vis/schedule-core'
import ScheduleGrid from './ScheduleGrid.vue'
import ScheduleDay from './ScheduleDay.vue'
import ScheduleSlot from './ScheduleSlot.vue'
import ScheduleCourse from './ScheduleCourse.vue'
import ScheduleInstructor from './ScheduleInstructor.vue'
import ScheduleCourseEdit from './ScheduleCourseEdit.vue'
import SchedulePicker from './SchedulePicker.vue'
import ScheduleFilters from './ScheduleFilters.vue'
import ScheduleManage from './ScheduleManage.vue'
import ScheduleAccess from './ScheduleAccess.vue'
import ScheduleAddCourse from './ScheduleAddCourse.vue'
import SuggestedChanges from './SuggestedChanges.vue'
import ScheduleHistory from './ScheduleHistory.vue'

import { computed, ref, watch, onBeforeUnmount } from 'vue'

export default {
  name: 'ScheduleApp',
  components: {
    ScheduleGrid,
    ScheduleDay,
    ScheduleSlot,
    ScheduleCourse,
    ScheduleInstructor,
    ScheduleCourseEdit,
    SchedulePicker,
    ScheduleFilters,
    ScheduleManage,
    ScheduleAccess,
    ScheduleAddCourse,
    SuggestedChanges,
    ScheduleHistory,
  },
  setup() {
    const route = useRoute()
    // Overlay routes (`.../access`, and later mode/proposals/editor) render
    // their dialog on top of the surface the user came from, so context (and
    // instance state like the manage search) survives. Remember that surface
    // while a non-overlay route is active; fall back to the grid on a deep
    // link into an overlay.
    const overlay = computed(() => String(route.meta.overlay || ''))
    const underlay = ref({ page: '', scheduleView: '' })
    watch(
      () => [route.meta.overlay, route.meta.page, route.meta.scheduleView],
      ([overlayNow, page, scheduleView]) => {
        if (!overlayNow) {
          underlay.value = { page: String(page || ''), scheduleView: String(scheduleView || '') }
        }
      },
      { immediate: true },
    )
    const view = computed(() =>
      overlay.value
        ? String(underlay.value.scheduleView || 'grid')
        : String(route.meta.scheduleView || 'grid'),
    )
    // "/schedules" is a page (not a dialog): the shell renders it as the body
    // in place of the active sub-view, like the /admin route does. While an
    // overlay is open it stays the underlay, so the page remains mounted.
    const isManagePage = computed(() =>
      overlay.value ? underlay.value.page === 'manage' : route.meta.page === 'manage',
    )
    const sortedCourses = computed(() => {
      if (!schedule.value) return []
      return Object.keys(schedule.value.byCourse).sort()
    })
    const selectedCode = computed(() => String(route.params.code || ''))
    const accessScheduleId = computed(() => String(route.params.id || ''))
    const showFilter = computed(() => ['grid', 'day', 'slot'].includes(view.value))

    // Filter mode buttons: clicking the active mode collapses the chips panel
    // (selections stay applied), clicking the other mode switches and opens it.
    const pickFilter = (mode) => {
      if (filterMode.value === mode) {
        filterPanelOpen.value = !filterPanelOpen.value
      } else {
        filterMode.value = mode
        filterPanelOpen.value = true
      }
    }
    const deptFilterCount = computed(() => selectedDepartments.value.length)
    const instructorFilterCount = computed(() => selectedInstructors.value.length)
    const clearActiveFilters = () => {
      if (filterMode.value === 'dept') selectedDepartments.value = []
      else selectedInstructors.value = []
    }

    // Course picker — the "course conflicts" dropdown. It stays open while
    // focus moves into the option list (blur only closes when focus leaves the
    // whole picker), so keyboard users can Tab into the results.
    const courseQuery = ref('')
    const courseOpen = ref(false)
    const coursePickerEl = ref(null)
    const onCourseBlur = (e) => {
      const next = e.relatedTarget
      if (next && coursePickerEl.value && coursePickerEl.value.contains(next)) return
      courseOpen.value = false
    }
    const courseResults = computed(() => {
      const q = courseQuery.value.trim().toLowerCase()
      const qn = q.replace(/\s+/g, '')
      let list = Object.keys(schedule.value?.byCourse || {}).sort()
      if (q) {
        list = list.filter(
          (code) =>
            code.replace(/\s+/g, '').toLowerCase().includes(qn) || courseName(code).toLowerCase().includes(q),
        )
      }
      return list
    })
    const pickCourse = (code) => {
      courseQuery.value = ''
      courseOpen.value = false
      goScheduleCourse(code)
    }

    // Modal visibility. The modals own their internal state; these refs only
    // gate whether each is open. (Manage is a route now, not a modal.)
    const showAddCourse = ref(false)
    const showSuggestions = ref(false)
    const showHistory = ref(false)

    // The schedule the suggestions panel acts on: the one being edited, else the
    // first selected schedule.
    const suggestionsScheduleId = computed(
      () => editingScheduleId.value || selectedScheduleIds.value[0] || null,
    )

    // Edit bar.
    const editingId = editingScheduleId
    const editingName = computed(() => (editingSchedule.value ? editingSchedule.value.name : ''))
    const nameDraft = ref('')
    const enterEdit = (id, role = 'edit') => {
      setEditingSchedule(id, role)
      nameDraft.value = editingSchedule.value ? editingSchedule.value.name : ''
      // Editing from the manage page leaves it for the active view; the picker
      // menu is already over a view, so it stays put.
      if (isManagePage.value) goBackOrGrid()
    }
    const exitEdit = () => {
      // Leaving a suggest session with unsaved draft changes asks first.
      const draft = editingDraft.value
      if (draft && draft.dirty) {
        if (!window.confirm('Discard your unsaved draft changes?')) return
        clearDraft(editingScheduleId.value, activeTerm.value)
      }
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

    // Global "cancel the latest change" while a session is active (Ctrl/Cmd+Z).
    // An editable field that has focus keeps the shortcut — that's browser
    // native text undo, not a session undo.
    const onGlobalKeydown = (e) => {
      const t = e.target
      if (!t) return
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return
      if (e.defaultPrevented) return
      if (!(e.metaKey || e.ctrlKey) || String(e.key).toLowerCase() !== 'z') return
      cancelLatest()
    }
    document.addEventListener('keydown', onGlobalKeydown)
    onBeforeUnmount(() => document.removeEventListener('keydown', onGlobalKeydown))

    // The History panel's "Edit" action: close the panel, then open the course
    // editor on that change's course (the editor renders above any view).
    const onEditCourse = (op) => {
      showHistory.value = false
      jumpToEdit(op)
    }

    return {
      view,
      sortedCourses,
      selectedCode,
      showFilter,
      remote,
      filterMode,
      filterPanelOpen,
      pickFilter,
      deptFilterCount,
      instructorFilterCount,
      clearActiveFilters,
      courseQuery,
      courseOpen,
      coursePickerEl,
      onCourseBlur,
      courseResults,
      courseName,
      pickCourse,
      schedule,
      schedules,
      selectedScheduleIds,
      overlay,
      accessScheduleId,
      isManagePage,
      goManage,
      goAccess,
      goBackOrGrid,
      showAddCourse,
      showSuggestions,
      showHistory,
      suggestionsScheduleId,
      editingId,
      editingRole,
      editingName,
      editingDraft,
      nameDraft,
      enterEdit,
      exitEdit,
      commitRename,
      activeTerm,
      setActiveTerm,
      showPendingSuggestions,
      setShowPendingSuggestions,
      pendingSuggestionsForTerm,
      blockMode,
      setBlockMode,
      TERM_KEYS,
      TERM_LABELS,
      courseEditTarget,
      closeCourseEdit,
      historyEntries,
      onEditCourse,
      goScheduleGrid,
      goScheduleCourse,
      goScheduleInstructor,
    }
  },
}
</script>
