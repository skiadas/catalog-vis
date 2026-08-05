import {
  programs,
  allCourses,
  takenSet,
  takenCourses,
  addedTracks,
  addedTracksDetailed,
  toggleTrack,
  programTracks,
  clearTracks,
  removeTrack,
  toggleTaken,
  resetTaken,
} from '../lib/store.js'
import { goToProgram, goToCourse } from '../lib/router.js'
import { evaluateProgram, audit } from '../lib/planner.js'
import TrackAudit from './TrackAudit.js'

const { ref, computed } = Vue

export default {
  name: 'PlannerApp',
  components: { TrackAudit },
  setup() {
    const query = ref('')
    const type = ref('all')
    const courseSearch = ref('')
    const showAdd = ref(false)

    const filteredPrograms = computed(() => {
      let list = programs.value
      if (type.value !== 'all') list = list.filter((p) => p.type.includes(type.value))
      const q = query.value.trim().toLowerCase()
      if (q) list = list.filter((p) => p.name.toLowerCase().includes(q))
      return list
    })

    const activeSet = computed(() => new Set(addedTracks.value.map((t) => `${t.programId}:${t.trackKey}`)))

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
      let list = Object.values(allCourses.value)
      if (q) {
        list = list.filter(
          (c) =>
            c.course_code.toLowerCase().includes(q) ||
            (c.course_name && c.course_name.toLowerCase().includes(q)),
        )
      }
      return list.sort((a, b) => a.course_code.localeCompare(b.course_code)).slice(0, 200)
    })

    return {
      query,
      type,
      courseSearch,
      showAdd,
      programTracks,
      filteredPrograms,
      activeSet,
      summary,
      matchingCourses,
      addedTracks,
      addedTracksDetailed,
      takenCourses,
      takenSet,
      toggleTrack,
      clearTracks,
      removeTrack,
      toggleTaken,
      resetTaken,
      goToProgram,
      goToCourse,
      allCourses,
    }
  },
  template: `
    <div>
      <div class="header">
        <h1>Course Planner</h1>
        <div class="header-sub">Add majors/minors, mark courses as taken, and see what you still need.</div>
      </div>

      <div class="planner-summary">
        <span class="planner-summary-item">{{ addedTracks.length }} track{{ addedTracks.length !== 1 ? 's' : '' }} added</span>
        <span class="planner-summary-item">{{ summary.satisfied }} of {{ summary.total }} satisfied</span>
        <span class="planner-summary-item">{{ takenCourses.length }} course{{ takenCourses.length !== 1 ? 's' : '' }} taken</span>
        <button v-if="addedTracks.length" class="planner-reset" @click="clearTracks()">Clear tracks</button>
      </div>

      <div class="planner-toolbar">
        <div class="section-title" style="margin: 0">Your Plan</div>
        <button class="add-track-btn" @click="showAdd = !showAdd">
          {{ showAdd ? 'Done adding' : 'Add track' }}
        </button>
      </div>
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

      <div v-if="showAdd">
        <div class="section-title">Add Majors / Minors</div>
        <div class="controls">
          <input class="search-input" type="text" placeholder="Search programs..." v-model="query" />
          <div class="filter-group">
            <button class="filter-btn" :class="{ active: type === 'all' }" @click="type = 'all'">All</button>
            <button class="filter-btn" :class="{ active: type === 'major' }" @click="type = 'major'">Majors</button>
            <button class="filter-btn" :class="{ active: type === 'minor' }" @click="type = 'minor'">Minors</button>
          </div>
        </div>

        <div class="program-grid">
          <div class="program-card" v-for="p in filteredPrograms" :key="p.id">
            <div class="program-card-head">
              <h3 class="program-card-title" @click="goToProgram(p.id)">{{ p.name }}</h3>
              <div class="meta">
                <span class="tag major" v-if="p.type.includes('major')">Major</span>
                <span class="tag minor" v-if="p.type.includes('minor')">Minor</span>
                <span class="tag program" v-if="!p.type.includes('major') && !p.type.includes('minor')">Program</span>
              </div>
            </div>
            <div class="track-chips">
              <span
                v-for="t in programTracks(p.id)"
                :key="t.trackKey"
                class="track-chip"
                :class="{ on: activeSet.has(p.id + ':' + t.trackKey) }"
                @click="toggleTrack(p.id, t.trackKey)"
              >{{ t.label }}</span>
              <span v-if="!programTracks(p.id).length" class="track-chip disabled">No structured requirements</span>
            </div>
            <div class="course-count">{{ p.course_count }} courses</div>
          </div>
        </div>

        <div v-if="filteredPrograms.length === 0" class="empty-state"><p>No programs match your search.</p></div>
      </div>

      <div class="section-title" style="margin-top: 28px">Courses You've Taken</div>
      <input v-model="courseSearch" class="planner-search" type="search" placeholder="Search any course code or name…" />
      <div class="planner-pick-list">
        <button
          v-for="c in matchingCourses"
          :key="c.course_code"
          class="planner-pick"
          :class="{ taken: takenSet.has(c.course_code) }"
          @click="toggleTaken(c.course_code)"
          :title="c.course_name"
        >
          <span class="planner-pick-code">{{ c.course_code }}</span>
          <span class="planner-pick-name">{{ c.course_name }}</span>
        </button>
        <div v-if="!matchingCourses.length" class="planner-pick-empty">No matching courses.</div>
      </div>

      <div v-if="takenCourses.length" class="taken-list">
        <span
          v-for="code in takenCourses"
          :key="code"
          class="course-chip"
          @click="toggleTaken(code)"
          :title="allCourses[code] ? allCourses[code].course_name : ''"
        >{{ code }} ✕</span>
        <button class="planner-reset" @click="resetTaken()">Reset taken courses</button>
      </div>
    </div>
  `,
}
