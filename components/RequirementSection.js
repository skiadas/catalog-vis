import { allCourses } from '../lib/store.js'
import { goToCourse } from '../lib/router.js'

export default {
  name: 'RequirementSection',
  props: {
    section: { type: Object, required: true }
  },
  setup(props) {
    function formatLevelConstraint(c) {
      if (c.comparison === 'or_above') return `${c.level}-level or above`
      if (c.comparison === 'exclude') return `Excluding ${c.level}-level`
      if (c.comparison === 'at_most') return c.min === 1 ? `No more than 1 at ${c.level}-level` : `No more than ${c.min} at ${c.level}-level`
      if (c.min) return `At least ${c.min} at ${c.level}-level`
      return `${c.level}-level`
    }

    function formatLevelGate(c) {
      if (c.comparison === 'exclude') return c.note || `Excluding ${c.level}-level courses`
      if (c.comparison === 'at_least') return c.note || `At least ${c.count || 1} at ${c.level}-level`
      if (c.comparison === 'at_most') return c.note || `No more than ${c.count || 1} at ${c.level}-level`
      return c.note || `${c.level}-level`
    }

    function isCulminating(note) {
      return note && note.toLowerCase().includes('culminating')
    }

    return { allCourses, goToCourse, formatLevelConstraint, formatLevelGate, isCulminating }
  },
  template: `
    <div class="req-section">
      <div v-if="section.heading" class="req-section-heading">{{ section.heading }}</div>
      <div class="req-items">
        <div v-for="(item, idx) in section.items" :key="idx" class="req-item">

          <template v-if="item.type === 'course'">
            <span class="course-chip" @click="goToCourse(item.code)" :title="allCourses[item.code] ? allCourses[item.code].course_name : ''">{{ item.code }}</span>
            <span v-if="isCulminating(item.note)" class="item-note culminating">★ {{ item.note }}</span>
            <span v-else-if="item.note" class="item-note">{{ item.note }}</span>
          </template>

          <template v-else-if="item.type === 'pair'">
            <template v-for="(code, pi) in item.codes" :key="code">
              <span class="course-chip" @click="goToCourse(code)" :title="allCourses[code] ? allCourses[code].course_name : ''">{{ code }}</span>
              <span v-if="pi < item.codes.length - 1" class="pair-plus">+</span>
            </template>
            <span v-if="item.note" class="item-note">{{ item.note }}</span>
          </template>

          <div v-else-if="item.type === 'any_of' && item.codes" class="anyof-group">
            <span class="anyof-label">Pick one:</span>
            <template v-for="(code, ci) in item.codes" :key="code">
              <span class="course-chip" @click="goToCourse(code)" :title="allCourses[code] ? allCourses[code].course_name : ''">{{ code }}</span>
              <span v-if="ci < item.codes.length - 1" class="anyof-or">OR</span>
            </template>
            <span v-if="item.note && !isCulminating(item.note)" class="item-note">{{ item.note }}</span>
            <span v-if="isCulminating(item.note)" class="item-note culminating">★ {{ item.note }}</span>
          </div>

          <div v-else-if="item.type === 'any_of' && item.items" class="anyof-items-group">
            <div class="anyof-label">{{ item.note || 'Choose one:' }}</div>
            <div v-for="(sub, si) in item.items" :key="si" class="anyof-subitem">
              <template v-if="sub.type === 'course'">
                <span class="course-chip" @click="goToCourse(sub.code)" :title="allCourses[sub.code] ? allCourses[sub.code].course_name : ''">{{ sub.code }}</span>
                <span v-if="sub.note" class="item-note">{{ sub.note }}</span>
              </template>
              <template v-else-if="sub.type === 'pair'">
                <template v-for="(code, pj) in sub.codes" :key="code">
                  <span class="course-chip" @click="goToCourse(code)" :title="allCourses[code] ? allCourses[code].course_name : ''">{{ code }}</span>
                  <span v-if="pj < sub.codes.length - 1" class="pair-plus">+</span>
                </template>
                <span v-if="sub.note" class="item-note">{{ sub.note }}</span>
              </template>
              <span v-else-if="sub.type === 'custom'" class="custom-text">{{ sub.text }}</span>
            </div>
          </div>

          <div v-else-if="item.type === 'electives'" class="electives-group">
            <div class="electives-header">
              <span class="electives-count">{{ item.count ? 'Choose ' + item.count : 'Choose' }} {{ item.count === 1 ? 'course' : 'courses' }}</span>
              <span v-if="item.note" class="item-note">{{ item.note }}</span>
            </div>
            <div v-if="item.constraints && item.constraints.length" class="constraints-list">
              <div v-for="(c, ci) in item.constraints" :key="ci" class="constraint-row">
                <template v-if="c.type === 'level'">
                  <span class="constraint-tag level">{{ formatLevelConstraint(c) }}</span>
                </template>
                <template v-else-if="c.type === 'exclude'">
                  <span class="constraint-tag exclude">
                    Not including:
                    <template v-for="(code, ei) in c.codes" :key="code">
                      <span class="course-chip mini" @click="goToCourse(code)" :title="allCourses[code] ? allCourses[code].course_name : ''">{{ code }}</span>
                      <template v-if="ei < c.codes.length - 1">, </template>
                    </template>
                  </span>
                </template>
                <template v-else-if="c.type === 'from' && c.codes">
                  <span class="constraint-tag from">
                    <template v-if="c.note">{{ c.note }}: </template>
                    <template v-else>From: </template>
                    <template v-for="(code, fi) in c.codes" :key="code">
                      <span class="course-chip mini" @click="goToCourse(code)" :title="allCourses[code] ? allCourses[code].course_name : ''">{{ code }}</span>
                      <template v-if="fi < c.codes.length - 1">, </template>
                    </template>
                  </span>
                </template>
                <template v-else-if="c.type === 'from' && c.note">
                  <span class="constraint-tag from note-only">{{ c.note }}</span>
                </template>
              </div>
            </div>
          </div>

          <span v-else-if="item.type === 'level_gate'" class="level-gate-badge">{{ formatLevelGate(item) }}</span>

          <span v-else-if="item.type === 'custom'" class="custom-text">{{ item.text }}</span>

        </div>
      </div>
    </div>
  `
}
