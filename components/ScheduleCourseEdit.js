import { SLOT_BLOCKS, WEEKDAYS, formatTime, compareInstructors } from '../lib/schedule.js'
import { scheduleById, updateOffering, removeCourseFromSchedule, allCourses } from '../lib/store.js'

const { computed, ref } = Vue

// The days each standard slot group can be scheduled on: MWF slots only ever
// meet M/W/F, TR slots only T/R. Picking a slot constrains the day toggles to
// its group.
const GROUP_DAYS = { MWF: ['M', 'W', 'F'], TR: ['T', 'R'] }

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
    const courseOfferings = computed(() => schedule.value?.offerings || [])

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

    // Time-slot groups, each with its own day letters and time options. A
    // non-standard current time is folded into the group matching its days.
    const dayGroups = computed(() => {
      const groups = SLOT_BLOCKS.map((b) => ({
        label: b.label,
        days: GROUP_DAYS[b.label],
        slots: b.slots.map((s) => s.time),
      }))
      const all = groups.flatMap((g) => g.slots)
      if (o.time && !all.includes(o.time)) {
        const label = (o.days || '').includes('T') || (o.days || '').includes('R') ? 'TR' : 'MWF'
        const grp = groups.find((g) => g.label === label)
        grp.slots = [...grp.slots, o.time]
      }
      return groups
    })

    const initLetters = (o.days || '').split('').filter((d) => 'MTWRF'.includes(d))
    const timeSel = ref(o.time || dayGroups.value[0].slots[0])
    // A single day set, scoped to the currently selected slot's group. Picking a
    // slot in another group resets the days to that group's full set.
    const daysSel = ref(initLetters)
    const timeGroupSel = computed(
      () => dayGroups.value.find((g) => g.slots.includes(timeSel.value))?.label || null,
    )
    const activeDays = computed(() => {
      const label = timeGroupSel.value
      if (!label) return []
      return daysSel.value.filter((d) => GROUP_DAYS[label].includes(d))
    })

    const pickTime = (label, t) => {
      timeSel.value = t
      daysSel.value = [...GROUP_DAYS[label]]
    }
    const toggleDay = (label, d) => {
      if (label !== timeGroupSel.value) return
      daysSel.value = daysSel.value.includes(d) ? daysSel.value.filter((x) => x !== d) : [...daysSel.value, d]
    }

    const canSave = computed(() => activeDays.value.length > 0 && Boolean(timeSel.value))

    const courseName = computed(() => allCourses.value[props.offering.code]?.course_name || '')

    const save = () => {
      if (!canSave.value) return
      const label = timeGroupSel.value
      const days = label ? WEEKDAYS.filter((d) => daysSel.value.includes(d)).join('') : o.days || ''
      updateOffering(
        props.scheduleId,
        { prefix: o.prefix, number: o.number, section: o.section },
        {
          instructor: instructorSel.value,
          section: sectionSel.value.trim() || o.section,
          days,
          time: timeSel.value,
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
      timeSel,
      dayGroups,
      daysSel,
      timeGroupSel,
      pickTime,
      toggleDay,
      canSave,
      save,
      removeCourse,
      courseName,
      formatTime,
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
            {{ courseName }} — editing this offering in <strong>{{ schedule.name }}</strong>. Any changes are saved
            to this schedule in your browser.
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
            <label>Time slot &amp; days</label>
            <div class="slot-time-groups">
              <div
                class="slot-time-group"
                v-for="g in dayGroups"
                :key="g.label"
                :class="{ on: timeGroupSel === g.label }"
              >
                <div class="slot-time-group-days">
                  <button
                    v-for="d in g.days"
                    :key="d"
                    type="button"
                    class="day-chip"
                    :class="{ on: daysSel.includes(d), disabled: timeGroupSel !== g.label }"
                    :disabled="timeGroupSel !== g.label"
                    :title="timeGroupSel === g.label ? '' : 'Pick a ' + g.label + ' time to change its days'"
                    @click="toggleDay(g.label, d)"
                  >{{ d }}</button>
                </div>
                <div class="slot-time-opts">
                  <button
                    v-for="s in g.slots"
                    :key="s"
                    type="button"
                    class="filter-btn slot-time-btn"
                    :class="{ active: timeSel === s }"
                    @click="pickTime(g.label, s)"
                  >{{ formatTime(s) }}</button>
                </div>
              </div>
            </div>
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
