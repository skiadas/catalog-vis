import {
  WEEKDAYS,
  formatTime,
  compareInstructors,
  termConfig,
  termSlotOptions,
} from '@major-vis/schedule-core'
import {
  scheduleById,
  updateOffering,
  removeCourseFromSchedule,
  activeTerm,
  editingRole,
} from '../src/scheduleStore.js'
import { courseName as catalogCourseName } from '@major-vis/catalog-client'

import { computed, ref } from 'vue'

// Day letters available per term group (Spring is a single MTWRF group).
const GROUP_DAYS = { MWF: ['M', 'W', 'F'], TR: ['T', 'R'], MTWRF: ['M', 'T', 'W', 'R', 'F'] }

export default {
  name: 'ScheduleCourseEdit',
  props: {
    scheduleId: { type: String, required: true },
    offering: { type: Object, required: true },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const o = props.offering.o

    const schedule = computed(() => scheduleById(props.scheduleId))

    // Instructor dropdowns are drawn from the whole *term* the course is in.
    const courseOfferings = computed(() => {
      const s = schedule.value
      const part = s && s.terms && s.terms[activeTerm.value]
      return part ? part.offerings : []
    })

    const deptInstructors = computed(() => {
      const set = new Set()
      for (const x of courseOfferings.value) {
        if (x.prefix === o.prefix && x.instructor) set.add(x.instructor)
      }
      return Array.from(set).sort(compareInstructors)
    })
    const allInstructors = computed(() => {
      const set = new Set()
      for (const x of courseOfferings.value) if (x.instructor) set.add(x.instructor)
      return Array.from(set).sort(compareInstructors)
    })

    const showAll = ref(o.instructor && !deptInstructors.value.includes(o.instructor))
    const instructorOptions = computed(() => (showAll.value ? allInstructors.value : deptInstructors.value))

    const instructorSel = ref(o.instructor || '')
    const sectionSel = ref(o.section || '')

    // --- Time mode -----------------------------------------------------
    // 'slot' (a term band), 'custom' (arbitrary start/end), or 'none'
    // (unscheduled — independent study with no meeting time).
    const config = termConfig(activeTerm.value)
    const initLetters = (o.days || '').split('').filter((d) => 'MTWRF'.includes(d))

    const timeMode = ref(o.time ? 'slot' : 'none')
    const timeSel = ref(o.time || '')
    const daysSel = ref(initLetters)
    const customStart = ref(o.time ? o.time.split('-')[0] : '12:00')
    const customEnd = ref(o.time ? o.time.split('-')[1] : '13:00')

    // The day group for the current selection (or the first group). Default to
    // the group that contains the course's existing days, else the term's first.
    const dayGroups = computed(() =>
      config.dayGroups.map((g) => ({
        label: g.label,
        days: GROUP_DAYS[g.label] || g.label.split(''),
      })),
    )
    const groupForDays = (letters) => {
      if (!letters.length) return config.dayGroups[0].label
      for (const g of config.dayGroups) {
        if (letters.every((d) => g.label.includes(d))) return g.label
      }
      return config.dayGroups[0].label
    }
    const timeGroupSel = ref(groupForDays(initLetters))

    const pickGroup = (label) => {
      timeGroupSel.value = label
      // adopt the group's full day set when switching groups
      daysSel.value = [...GROUP_DAYS[label]]
    }
    const toggleDay = (d) => {
      const g = GROUP_DAYS[timeGroupSel.value]
      if (!g.includes(d)) return
      daysSel.value = daysSel.value.includes(d) ? daysSel.value.filter((x) => x !== d) : [...daysSel.value, d]
    }

    // Term slot bands for the active day group (incl. consecutive pairs in Spring).
    const groupSlots = computed(() => {
      const label = timeGroupSel.value
      const day = (GROUP_DAYS[label] || 'M')[0]
      return termSlotOptions(activeTerm.value, day).map((s) => s.time)
    })
    const slotOptions = computed(() => {
      const base = groupSlots.value
      if (timeMode.value === 'custom' && timeSel.value && !base.includes(timeSel.value)) {
        return [...base, timeSel.value]
      }
      return base
    })

    const canSave = computed(() => {
      if (timeMode.value === 'none') return true
      if (timeMode.value === 'custom') return Boolean(customStart.value && customEnd.value)
      return Boolean(timeSel.value)
    })

    const courseName = computed(() => catalogCourseName(props.offering.code))
    const termLabel = computed(() => termConfig(activeTerm.value).label)

    const save = () => {
      if (!canSave.value) return
      let days = o.days || ''
      let time = o.time || ''
      if (timeMode.value === 'none') {
        days = ''
        time = ''
      } else if (timeMode.value === 'custom') {
        days = WEEKDAYS.filter((d) => daysSel.value.includes(d)).join('')
        time = `${customStart.value}-${customEnd.value}`
      } else {
        days = WEEKDAYS.filter((d) => daysSel.value.includes(d)).join('')
        time = timeSel.value
      }
      updateOffering(
        props.scheduleId,
        { prefix: o.prefix, number: o.number, section: o.section },
        {
          instructor: instructorSel.value,
          section: sectionSel.value.trim() || o.section,
          days,
          time,
        },
      )
      emit('close')
    }

    const removeCourse = () => {
      removeCourseFromSchedule(props.scheduleId, {
        prefix: o.prefix,
        number: o.number,
        section: o.section,
      })
      emit('close')
    }

    return {
      schedule,
      showAll,
      instructorOptions,
      instructorSel,
      sectionSel,
      timeMode,
      timeSel,
      slotOptions,
      dayGroups,
      daysSel,
      timeGroupSel,
      pickGroup,
      toggleDay,
      customStart,
      customEnd,
      canSave,
      save,
      removeCourse,
      courseName,
      termLabel,
      formatTime,
      activeTerm,
      editingRole,
      GROUP_DAYS,
    }
  },
  template: `
    <div class="modal-overlay" @click.self="$emit('close')">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="course-edit-title">
        <div class="modal-head">
          <h3 id="course-edit-title">Edit {{ offering.code }}</h3>
          <button class="modal-close" @click="$emit('close')" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="modal-intro">
            {{ courseName }} — editing this offering in <strong>{{ schedule.name }}</strong>
            ({{ termLabel }}).
            <template v-if="editingRole === 'suggest'">These changes are collected into a proposal for the owner; nothing is written to the schedule until it's approved.</template>
            <template v-else>Any changes are saved to this schedule in your browser.</template>
          </p>

          <div class="field">
            <label>Instructor</label>
            <div class="filter-group">
              <button class="filter-btn" :class="{ active: !showAll }" @click="showAll = false">Department</button>
              <button class="filter-btn" :class="{ active: showAll }" @click="showAll = true">All instructors</button>
            </div>
            <select class="search-input" v-model="instructorSel">
              <option value="">— No instructor —</option>
              <option v-for="i in instructorOptions" :key="i" :value="i">{{ i }}</option>
            </select>
          </div>

          <div class="field">
            <label for="course-edit-section">Section</label>
            <input id="course-edit-section" class="search-input" type="text" maxlength="4" v-model="sectionSel" placeholder="A" />
          </div>

          <div class="field">
            <label>Meeting time</label>
            <div class="filter-group">
              <button class="filter-btn" :class="{ active: timeMode === 'slot' }" @click="timeMode = 'slot'">Time slot</button>
              <button class="filter-btn" :class="{ active: timeMode === 'custom' }" @click="timeMode = 'custom'">Custom time</button>
              <button class="filter-btn" :class="{ active: timeMode === 'none' }" @click="timeMode = 'none'">No meeting time</button>
            </div>

            <div v-if="timeMode !== 'none'" class="slot-time-groups">
              <div class="slot-time-group" v-for="g in dayGroups" :key="g.label" :class="{ inactive: timeGroupSel !== g.label }">
                <button class="slot-time-group-name" :class="{ active: timeGroupSel === g.label }" @click="pickGroup(g.label)">
                  {{ g.label }}
                </button>
                <div class="slot-time-group-days">
                  <button
                    v-for="d in g.days"
                    :key="d"
                    type="button"
                    class="day-chip"
                    :class="{ active: daysSel.includes(d), disabled: timeGroupSel !== g.label }"
                    :disabled="timeGroupSel !== g.label"
                    @click="timeGroupSel === g.label && toggleDay(d)"
                  >{{ d }}</button>
                </div>
              </div>

              <div v-if="timeMode === 'slot'" class="slot-time-opts">
                <button
                  v-for="s in slotOptions"
                  :key="s"
                  type="button"
                  class="filter-btn slot-time-btn"
                  :class="{ active: timeSel === s }"
                  @click="timeSel = s"
                >{{ formatTime(s) }}</button>
              </div>

              <div v-if="timeMode === 'custom'" class="custom-time-row">
                <input class="search-input" type="time" v-model="customStart" aria-label="Start time" />
                <span class="custom-time-sep">to</span>
                <input class="search-input" type="time" v-model="customEnd" aria-label="End time" />
              </div>
            </div>
            <p v-else class="field-hint">Independent studies and the like can sit in the schedule without a meeting time.</p>
          </div>

          <div class="controls">
            <button class="filter-btn remove-course-btn" @click="removeCourse">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              Remove course
            </button>
            <span class="controls-spacer"></span>
            <button class="filter-btn" @click="$emit('close')">Cancel</button>
            <button class="filter-btn primary" :disabled="!canSave" @click="save">Save changes</button>
          </div>
        </div>
      </div>
    </div>
  `,
}
