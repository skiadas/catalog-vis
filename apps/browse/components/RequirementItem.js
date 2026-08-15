import { courseName } from '@major-vis/catalog-client'
import { goToCourse } from '../router.js'

const { computed } = Vue

export default {
  name: 'RequirementItem',
  props: {
    item: { type: Object, required: true },
  },
  setup(props) {
    const isNested = computed(() => {
      const item = props.item
      return item && item.type === 'any_of' && item.items && item.items.length
    })

    const eachOfInline = computed(() => {
      const item = props.item
      return (
        item &&
        item.type === 'each_of' &&
        item.items &&
        item.items.length &&
        item.items.every((s) => s.type === 'course')
      )
    })

    function formatLevelConstraint(c) {
      const above = c.orAbove || c.comparison === 'or_above'
      if (c.min !== undefined && c.max !== undefined) {
        const band = `Level ${c.min}–${c.max}`
        if (c.atLeast) return `At least ${c.atLeast} from ${band}`
        if (c.atMost) return `No more than ${c.atMost} from ${band}`
        return band
      }
      const placement = above ? ` at or above the ${c.level} level` : ` at the ${c.level} level`
      const atMost = c.atMost !== undefined ? c.atMost : c.comparison === 'at_most' ? c.min : undefined
      if (atMost !== undefined) return `No more than ${atMost}${placement}`
      if (c.comparison === 'exclude') return `Excluding the ${c.level} level`
      const atLeast = c.atLeast !== undefined ? c.atLeast : c.min
      if (atLeast) return `At least ${atLeast}${placement}`
      return above ? `At the ${c.level} level or above` : `the ${c.level} level`
    }

    function formatDiscipline(c) {
      const scope = c.prefixes && c.prefixes.length ? c.prefixes.join('/') : 'any single discipline'
      if (c.distinctAtLeast) return `Across at least ${c.distinctAtLeast} different disciplines`
      if (c.distinctAtMost) return `Across at most ${c.distinctAtMost} different disciplines`
      if (c.atLeast) return `At least ${c.atLeast} in ${scope}`
      if (c.atMost) return `No more than ${c.atMost} in ${scope}`
      return `In ${scope}`
    }

    function formatLevelGate(c) {
      if (c.comparison === 'exclude') return c.note || `Excluding ${c.level} level courses`
      if (c.comparison === 'at_least') return c.note || `At least ${c.count || 1} at the ${c.level} level`
      if (c.comparison === 'at_most') return c.note || `No more than ${c.count || 1} at the ${c.level} level`
      return c.note || `the ${c.level} level`
    }

    function isCulminating(note) {
      return note && note.toLowerCase().includes('culminating')
    }

    function someOfLabel() {
      const item = props.item
      if (item.note) return item.note
      return 'Choose ' + item.min + ' of the following:'
    }

    return {
      courseName,
      goToCourse,
      formatLevelConstraint,
      formatDiscipline,
      formatLevelGate,
      isCulminating,
      isNested,
      eachOfInline,
      someOfLabel,
    }
  },
  template: `
    <div v-if="item.type === 'course_group'" class="course-group">
      <template v-for="(course, ci) in item.courses" :key="ci">
        <span class="course-chip" @click="goToCourse(course.code)" :title="courseName(course.code)">{{ course.code }}</span>
        <span v-if="isCulminating(course.note)" class="item-note culminating">★ {{ course.note }}</span>
        <span v-else-if="course.note" class="item-note">{{ course.note }}</span>
      </template>
    </div>

    <template v-else-if="item.type === 'course'">
      <span class="course-chip" @click="goToCourse(item.code)" :title="courseName(item.code)">{{ item.code }}</span>
      <span v-if="isCulminating(item.note)" class="item-note culminating">★ {{ item.note }}</span>
      <span v-else-if="item.note" class="item-note">{{ item.note }}</span>
    </template>

    <div v-else-if="item.type === 'pair'" class="pair-group">
      <template v-for="(code, pi) in item.codes" :key="code">
        <span class="course-chip" @click="goToCourse(code)" :title="courseName(code)">{{ code }}</span>
        <span v-if="pi < item.codes.length - 1" class="pair-plus">+</span>
      </template>
      <span v-if="item.note" class="item-note">{{ item.note }}</span>
    </div>

    <div v-else-if="item.type === 'any_of' && item.codes" class="anyof-group">
      <span class="anyof-label">Choose one:</span>
      <template v-for="(code, ci) in item.codes" :key="code">
        <span class="course-chip" @click="goToCourse(code)" :title="courseName(code)">{{ code }}</span>
        <span v-if="ci < item.codes.length - 1" class="anyof-or">OR</span>
      </template>
      <span v-if="item.note && !isCulminating(item.note)" class="item-note">{{ item.note }}</span>
      <span v-if="isCulminating(item.note)" class="item-note culminating">★ {{ item.note }}</span>
    </div>

    <div v-else-if="isNested" class="anyof-items-group">
      <div class="anyof-label">{{ item.note || 'Choose one of the following options:' }}</div>
      <div v-for="(sub, si) in item.items" :key="si" class="anyof-subitem">
        <span class="anyof-option">{{ 'Option ' + (si + 1) }}</span>
        <RequirementItem :item="sub" />
      </div>
    </div>

    <div v-else-if="eachOfInline" class="pair-group">
      <template v-for="(sub, di) in item.items" :key="di">
        <span class="course-chip" @click="goToCourse(sub.code)" :title="courseName(sub.code)">{{ sub.code }}</span>
        <span v-if="di < item.items.length - 1" class="pair-plus">+</span>
      </template>
      <span v-if="item.note" class="item-note">{{ item.note }}</span>
    </div>

    <div v-else-if="item.type === 'each_of'" class="eachof-group">
      <div class="eachof-label">{{ item.note || 'Complete all of the following:' }}</div>
      <div v-for="(sub, di) in item.items" :key="di" class="eachof-subitem">
        <RequirementItem :item="sub" />
      </div>
    </div>

    <div v-else-if="item.type === 'some_of'" class="eachof-group">
      <div class="eachof-label">{{ someOfLabel() }}</div>
      <div v-for="(sub, sii) in item.items" :key="sii" class="eachof-subitem">
        <RequirementItem :item="sub" />
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
          <template v-else-if="c.type === 'discipline'">
            <span class="constraint-tag discipline">{{ formatDiscipline(c) }}</span>
          </template>
          <template v-else-if="c.type === 'exclude'">
            <span class="constraint-tag exclude">
              Not including:
              <template v-for="(code, ei) in c.codes" :key="code">
                <span class="course-chip mini" @click="goToCourse(code)" :title="courseName(code)">{{ code }}</span>
                <template v-if="ei < c.codes.length - 1">, </template>
              </template>
            </span>
          </template>
          <template v-else-if="c.type === 'from' && c.codes">
            <span class="constraint-tag from">
              <span class="constraint-note" v-if="c.note">{{ c.note }}</span>
              <span class="constraint-from-label">Choose from:</span>
              <template v-for="(code, fi) in c.codes" :key="code">
                <span class="course-chip mini" @click="goToCourse(code)" :title="courseName(code)">{{ code }}</span>
                <template v-if="fi < c.codes.length - 1">, </template>
              </template>
            </span>
          </template>
          <template v-else-if="c.type === 'from' && c.note">
            <span class="constraint-tag from note-only">{{ c.note }}</span>
          </template>
          <template v-else-if="c.type === 'max_from'">
            <span class="constraint-tag from">
              <span class="constraint-note">{{ 'At most ' + c.atMost + ' of:' }}</span>
              <template v-for="(code, xi) in c.codes" :key="code">
                <span class="course-chip mini" @click="goToCourse(code)" :title="courseName(code)">{{ code }}</span>
                <template v-if="xi < c.codes.length - 1">, </template>
              </template>
              <span v-if="c.note" class="constraint-note">{{ c.note }}</span>
            </span>
          </template>
          <template v-else-if="c.type === 'min_from'">
            <span class="constraint-tag from">
              <span class="constraint-note">{{ 'At least ' + c.atLeast + ' of:' }}</span>
              <template v-for="(code, yi) in c.codes" :key="code">
                <span class="course-chip mini" @click="goToCourse(code)" :title="courseName(code)">{{ code }}</span>
                <template v-if="yi < c.codes.length - 1">, </template>
              </template>
              <span v-if="c.note" class="constraint-note">{{ c.note }}</span>
            </span>
          </template>
        </div>
      </div>
    </div>

    <span v-else-if="item.type === 'level_gate'" class="level-gate-badge">{{ formatLevelGate(item) }}</span>

    <span v-else-if="item.type === 'custom'" class="custom-text">{{ item.text }}</span>
  `,
}
