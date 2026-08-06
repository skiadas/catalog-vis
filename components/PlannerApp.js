import {
  programs,
  allCourses,
  takenSet,
  takenCourses,
  addedTracks,
  addedTracksDetailed,
  toggleTrack,
  programTracks,
  removeTrack,
  placeCourse,
  removeCourse,
  plans,
  currentPlanId,
  currentName,
  setName,
  loadPlan,
  newPlan,
  duplicatePlan,
  deletePlan,
} from '../lib/store.js'
import { goToProgram, goToCourse } from '../lib/router.js'
import { evaluateProgram, audit } from '../lib/planner.js'
import TrackAudit from './TrackAudit.js'
import PlannerTimeline from './PlannerTimeline.js'

const { ref, computed, nextTick } = Vue

export default {
  name: 'PlannerApp',
  components: { TrackAudit, PlannerTimeline },
  setup() {
    const tab = ref('plan')
    const query = ref('')
    const type = ref('all')
    const courseSearch = ref('')
    const showAddCourse = ref(false)
    const showAddTrack = ref(false)

    const filteredPrograms = computed(() => {
      let list = programs.value
      if (type.value !== 'all') list = list.filter((p) => p.type.includes(type.value))
      const q = query.value.trim().toLowerCase()
      if (q) list = list.filter((p) => p.name.toLowerCase().includes(q))
      return list
    })

    const activeSet = computed(() => new Set(addedTracks.value.map((t) => `${t.programId}:${t.trackKey}`)))

    function filteredTracksFor(program) {
      const tracks = programTracks(program.id)
      if (type.value === 'all') return tracks
      const needle = type.value
      return tracks.filter((t) => t.label.toLowerCase().includes(needle))
    }

    const summary = computed(() => {
      const st = {
        satisfied: 0,
        partial: 0,
        unsatisfied: 0,
        unknown: 0,
        total: addedTracksDetailed.value.length,
      }
      for (const t of addedTracksDetailed.value) {
        const s = audit(evaluateProgram([t.requirement], takenSet.value, allCourses.value)).requirements[0]
          .status
        if (s in st) st[s] += 1
      }
      return st
    })

    const matchingCourses = computed(() => {
      const q = courseSearch.value.trim().toLowerCase()
      const qn = q.replace(/\s+/g, '')
      let list = Object.values(allCourses.value)
      if (q) {
        list = list.filter(
          (c) =>
            c.course_code.replace(/\s+/g, '').toLowerCase().includes(qn) ||
            (c.course_name && c.course_name.toLowerCase().includes(q)),
        )
      }
      return list.sort((a, b) => a.course_code.localeCompare(b.course_code)).slice(0, 200)
    })

    // Clicking a course toggles it into/out of the plan (lands on the shelf).
    function togglePlaced(code) {
      if (takenSet.value.has(code)) removeCourse(code)
      else placeCourse(code)
    }

    const courseInput = ref(null)
    const programInput = ref(null)

    function openAddCourse() {
      showAddCourse.value = true
      nextTick(() => courseInput.value && courseInput.value.focus())
    }

    function openAddTrack() {
      showAddTrack.value = true
      nextTick(() => programInput.value && programInput.value.focus())
    }

    return {
      tab,
      query,
      type,
      courseSearch,
      showAddCourse,
      showAddTrack,
      courseInput,
      programInput,
      openAddCourse,
      openAddTrack,
      programTracks,
      filteredTracksFor,
      filteredPrograms,
      activeSet,
      summary,
      matchingCourses,
      addedTracks,
      addedTracksDetailed,
      takenCourses,
      takenSet,
      toggleTrack,
      removeTrack,
      togglePlaced,
      plans,
      currentPlanId,
      currentName,
      setName,
      loadPlan,
      newPlan,
      duplicatePlan,
      deletePlan,
      goToProgram,
      goToCourse,
      allCourses,
    }
  },
  template: `
    <div>
      <div class="header planner-head">
        <div class="planner-head-title">
          <h1>Course Planner</h1>
          <div class="header-sub">Plan when you'll take courses and track what you still need.</div>
        </div>
        <div class="planner-top-left">
          <input
            class="planner-plan-name"
            type="text"
            :value="currentName"
            @input="setName($event.target.value)"
            placeholder="Plan name…"
          />
          <select class="planner-plan-select" :value="currentPlanId" @change="loadPlan($event.target.value)">
            <option v-for="p in plans" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <span class="planner-plan-actions">
            <button class="planner-icon-btn" @click="newPlan()" title="New plan">New</button>
            <button class="planner-icon-btn" @click="duplicatePlan()" title="Duplicate plan">Duplicate</button>
            <button class="planner-icon-btn" @click="deletePlan()" title="Delete plan">Delete</button>
          </span>
        </div>
      </div>

      <div class="planner-top">
        <span class="planner-summary-item">{{ takenCourses.length }} course{{ takenCourses.length !== 1 ? 's' : '' }} planned</span>
        <span class="planner-summary-item">{{ summary.satisfied }}/{{ summary.total }} tracks satisfied</span>
        <span class="planner-top-spacer"></span>
        <button class="planner-add-btn" @click="openAddCourse()">＋ Add course</button>
        <button class="planner-add-btn primary" @click="openAddTrack()">＋ Add track</button>
      </div>

      <div class="planner-tabs">
        <button class="planner-tab" :class="{ active: tab === 'plan' }" @click="tab = 'plan'">Plan</button>
        <button
          class="planner-tab"
          :class="{ active: tab === 'requirements' }"
          @click="tab = 'requirements'"
        >
          Requirements{{ addedTracks.length ? ' (' + addedTracks.length + ')' : '' }}
        </button>
      </div>

      <div v-if="tab === 'plan'">
        <PlannerTimeline />
      </div>

      <div v-else>
        <div v-if="addedTracksDetailed.length" class="planner-plan">
          <TrackAudit
            v-for="t in addedTracksDetailed"
            :key="t.programId + ':' + t.trackKey"
            :program="t.program"
            :parsed="[t.requirement]"
            :label="t.program.name + ' · ' + t.requirement.label"
            @remove="removeTrack(t.program.id, t.trackKey)"
          />
        </div>
        <div v-else class="empty-state">
          <p>No tracks yet. Click <strong>Add track</strong> to start planning a major or minor.</p>
        </div>
      </div>

      <div v-if="showAddCourse" class="modal-overlay" @click.self="showAddCourse = false" @keydown.esc="showAddCourse = false">
        <div class="modal modal-wide">
          <div class="modal-head">
            <span class="section-title" style="margin: 0">Add Courses</span>
            <button class="modal-close" @click="showAddCourse = false" title="Close">✕</button>
          </div>
          <input
            v-model="courseSearch"
            class="planner-search"
            type="search"
            ref="courseInput"
            placeholder="Type a course code or name to search…"
          />
          <div v-if="courseSearch.trim()" class="planner-pick-list">
            <button
              v-for="c in matchingCourses"
              :key="c.course_code"
              class="planner-pick"
              :class="{ taken: takenSet.has(c.course_code) }"
              @click="togglePlaced(c.course_code)"
              :title="c.course_name"
            >
              <span class="planner-pick-code">{{ c.course_code }}</span>
              <span class="planner-pick-name">{{ c.course_name }}</span>
            </button>
            <div v-if="!matchingCourses.length" class="planner-pick-empty">No matching courses.</div>
          </div>
          <div v-else class="planner-pick-hint">
            Search for a course to add it to your plan. It lands on the "unassigned" shelf — drag it into a term afterwards.
          </div>
        </div>
      </div>

      <div v-if="showAddTrack" class="modal-overlay" @click.self="showAddTrack = false" @keydown.esc="showAddTrack = false">
        <div class="modal">
          <div class="modal-head">
            <span class="section-title" style="margin: 0">Add Majors / Minors</span>
            <button class="modal-close" @click="showAddTrack = false" title="Close">✕</button>
          </div>
          <div class="controls">
            <input ref="programInput" class="search-input" type="text" placeholder="Search programs..." v-model="query" />
            <div class="filter-group">
              <button class="filter-btn" :class="{ active: type === 'all' }" @click="type = 'all'">All</button>
              <button class="filter-btn" :class="{ active: type === 'major' }" @click="type = 'major'">Majors</button>
              <button class="filter-btn" :class="{ active: type === 'minor' }" @click="type = 'minor'">Minors</button>
            </div>
          </div>

          <div class="add-program-list">
            <div class="add-program-row" v-for="p in filteredPrograms" :key="p.id">
              <button class="add-program-name" @click="goToProgram(p.id)">{{ p.name }}</button>
              <div class="add-program-chips">
                <span
                  v-for="t in filteredTracksFor(p)"
                  :key="t.trackKey"
                  class="track-chip"
                  :class="{ on: activeSet.has(p.id + ':' + t.trackKey) }"
                  @click="toggleTrack(p.id, t.trackKey)"
                >{{ t.label }}</span>
                <span v-if="!filteredTracksFor(p).length" class="track-chip disabled">No structured requirements</span>
              </div>
            </div>
          </div>

          <div v-if="filteredPrograms.length === 0" class="empty-state"><p>No programs match your search.</p></div>
        </div>
      </div>
    </div>
  `,
}
