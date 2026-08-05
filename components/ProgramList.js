import { filteredPrograms, programs, loading, searchQuery, filterType } from '../lib/store.js'
import { addProgramTracks } from '../lib/store.js'
import { goToProgram, goPlanner } from '../lib/router.js'

export default {
  name: 'ProgramList',
  setup() {
    function openInPlanner(pid) {
      addProgramTracks(pid)
      goPlanner()
    }
    return { filteredPrograms, programs, loading, searchQuery, filterType, goToProgram, openInPlanner }
  },
  template: `
    <div>
      <div class="header">
        <h1 @click="goToProgram('')" style="display:inline-block">Hanover College</h1>
        <div class="header-sub">Academic Catalog 2025-2026 — All Programs</div>
        <div class="controls">
          <input
            class="search-input"
            type="text"
            placeholder="Search programs..."
            v-model="searchQuery"
          >
          <div class="filter-group">
            <button
              class="filter-btn"
              :class="{ active: filterType === 'all' }"
              @click="filterType = 'all'"
            >All</button>
            <button
              class="filter-btn"
              :class="{ active: filterType === 'major' }"
              @click="filterType = 'major'"
            >Majors</button>
            <button
              class="filter-btn"
              :class="{ active: filterType === 'minor' }"
              @click="filterType = 'minor'"
            >Minors</button>
          </div>
        </div>
      </div>

      <div class="results-count" v-if="filteredPrograms.length !== programs.length">
        Showing {{ filteredPrograms.length }} of {{ programs.length }} programs
      </div>

      <div class="program-grid">
        <div
          class="program-card"
          v-for="p in filteredPrograms"
          :key="p.id"
          @click="openInPlanner(p.id)"
        >
          <h3>{{ p.name }}</h3>
          <div class="meta">
            <span class="tag major" v-if="p.type.includes('major')">Major</span>
            <span class="tag minor" v-if="p.type.includes('minor')">Minor</span>
            <span class="tag program" v-if="!p.type.includes('major') && !p.type.includes('minor')">Program</span>
          </div>
          <div class="course-count">{{ p.course_count }} courses</div>
          <div class="program-card-actions">
            <span class="program-card-plan">Add to planner</span>
            <span class="program-card-detail" @click.stop="goToProgram(p.id)">Details →</span>
          </div>
        </div>
      </div>

      <div class="empty-state" v-if="filteredPrograms.length === 0">
        <p>No programs match your search.</p>
      </div>
    </div>
  `,
}
