import { filteredPrograms, programs, loading, searchQuery, filterType } from '@major-vis/catalog-client'
import { goToProgram } from '../router.js'

export default {
  name: 'ProgramList',
  setup() {
    return { filteredPrograms, programs, loading, searchQuery, filterType, goToProgram }
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
          @click="goToProgram(p.id)"
        >
          <h3>{{ p.name }}</h3>
          <div class="meta">
            <span class="tag major" v-if="p.type.includes('major')">Major</span>
            <span class="tag minor" v-if="p.type.includes('minor')">Minor</span>
            <span class="tag program" v-if="!p.type.includes('major') && !p.type.includes('minor')">Program</span>
          </div>
        </div>
      </div>

      <div class="empty-state" v-if="filteredPrograms.length === 0">
        <p>No programs match your search.</p>
      </div>
    </div>
  `,
}
