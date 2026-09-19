<template>
  <div class="modal-overlay" @click.self="close">
    <div
      ref="modalEl"
      class="modal modal-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-edit-title"
    >
      <div class="modal-head">
        <h3 id="course-edit-title">Edit {{ codeLabel }} {{ sectionLabel }}</h3>
        <select
          v-if="sections.length > 1"
          class="search-input course-edit-section-select"
          aria-label="Section"
          :value="offeringKey"
          @change="onSwitch"
        >
          <option v-for="s in sections" :key="offeringItemKey(s)" :value="offeringItemKey(s)">
            {{ sectionOptionLabel(s) }}
          </option>
        </select>
        <button class="modal-close" @click="close" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p class="modal-intro">
          {{ courseName }} — editing this offering in <strong>{{ schedule.name }}</strong> ({{ termLabel }}).
          <template v-if="editingRole === 'suggest'"
            >These changes are collected into a proposal for the owner; nothing is written to the schedule
            until it's approved.</template
          >
          <template v-else>Any changes are saved to this schedule in your browser.</template>
        </p>

        <div class="field-row">
          <div class="field">
            <label for="course-edit-instructor">Instructor</label>
            <div class="filter-group" role="group" aria-label="Instructor list">
              <button
                class="filter-btn"
                :class="{ active: !showAll }"
                :aria-pressed="!showAll"
                @click="showAll = false"
              >
                Department
              </button>
              <button
                class="filter-btn"
                :class="{ active: showAll }"
                :aria-pressed="showAll"
                @click="showAll = true"
              >
                All instructors
              </button>
            </div>
            <div class="secondary-suggest-wrap" ref="instructorSuggestEl">
              <input
                id="course-edit-instructor"
                ref="instructorEl"
                class="search-input"
                type="text"
                v-model="instructorSel"
                placeholder="Type or pick a name…"
                @focus="instructorSuggestOpen = true"
                @blur="onInstructorBlur"
                @keydown.esc="instructorSuggestOpen = false"
              />
              <div
                v-if="instructorSuggestOpen && instructorSuggestions.length"
                class="course-picker-dropdown"
              >
                <button
                  v-for="n in instructorSuggestions"
                  :key="n"
                  type="button"
                  class="course-picker-option"
                  @mousedown.prevent
                  @click="pickInstructor(n)"
                >
                  <span class="planner-pick-code">{{ n }}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="field field-fit">
            <label for="course-edit-section">Section</label>
            <input
              id="course-edit-section"
              class="search-input"
              type="text"
              maxlength="4"
              v-model="sectionSel"
              placeholder="A"
            />
          </div>
        </div>

        <div class="field">
          <label for="course-edit-secondary">Other instructors</label>
          <div class="secondary-suggest-wrap" ref="secondarySuggestEl">
            <input
              id="course-edit-secondary"
              class="search-input"
              type="text"
              v-model="secondaryText"
              placeholder="e.g. Smith, Jones"
              @focus="suggestOpen = true"
              @blur="onSecondaryBlur"
              @keydown.esc="suggestOpen = false"
            />
            <div v-if="suggestOpen && secondarySuggestions.length" class="course-picker-dropdown">
              <button
                v-for="n in secondarySuggestions"
                :key="n"
                type="button"
                class="course-picker-option"
                @mousedown.prevent
                @click="pickSecondary(n)"
              >
                <span class="planner-pick-code">{{ n }}</span>
              </button>
            </div>
          </div>
          <p class="field-hint">
            Comma-separated (like the registrar's <code>secondary_instr</code> column); leave blank for none.
          </p>
        </div>

        <div class="field">
          <span class="field-label">Meeting time</span>
          <div class="seg" role="group" aria-label="Meeting time">
            <button
              class="seg-btn"
              :class="{ active: timeMode === 'slot' }"
              :aria-pressed="timeMode === 'slot'"
              @click="timeMode = 'slot'"
            >
              Time slot
            </button>
            <button
              class="seg-btn"
              :class="{ active: timeMode === 'custom' }"
              :aria-pressed="timeMode === 'custom'"
              @click="timeMode = 'custom'"
            >
              Custom time
            </button>
            <button
              class="seg-btn"
              :class="{ active: timeMode === 'none' }"
              :aria-pressed="timeMode === 'none'"
              @click="timeMode = 'none'"
            >
              No meeting time
            </button>
          </div>

          <div v-if="timeMode !== 'none'" class="slot-time-groups">
            <div
              class="slot-time-group"
              v-for="g in dayGroups"
              :key="g.label"
              :class="{ inactive: timeGroupSel !== g.label }"
            >
              <button
                class="slot-time-group-name"
                :class="{ active: timeGroupSel === g.label }"
                :aria-pressed="timeGroupSel === g.label"
                @click="pickGroup(g.label)"
              >
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
                  :aria-pressed="daysSel.includes(d)"
                  @click="timeGroupSel === g.label && toggleDay(d)"
                >
                  {{ d }}
                </button>
              </div>
              <div v-if="timeMode === 'slot'" class="slot-time-opts">
                <button
                  v-for="s in slotsForGroup(g.label)"
                  :key="s"
                  type="button"
                  class="filter-btn slot-time-btn"
                  :class="{ active: timeSel === s }"
                  :disabled="timeGroupSel !== g.label"
                  @click="timeGroupSel === g.label && (timeSel = s)"
                >
                  {{ s }}
                </button>
              </div>
            </div>

            <div v-if="timeMode === 'custom'" class="custom-time-row">
              <input
                ref="startTimeEl"
                class="search-input"
                type="text"
                placeholder="e.g. 09:00"
                :value="customStart"
                aria-label="Start time"
                @change="onStartTimeInput"
              />
              <span class="custom-time-sep">to</span>
              <input
                ref="endTimeEl"
                class="search-input"
                type="text"
                placeholder="e.g. 10:00"
                :value="customEnd"
                aria-label="End time"
                @change="onEndTimeInput"
              />
            </div>
            <p v-if="timeHint" class="field-hint">{{ timeHint }}</p>
          </div>
          <p v-else class="field-hint">
            Independent studies and the like can sit in the schedule without a meeting time.
          </p>
        </div>

        <div v-if="!isLab" class="add-lab-row">
          <button v-if="!labAdded" class="filter-btn add-lab-btn" @click="addLab">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"
              />
              <path d="M8.5 2h7" />
              <path d="M7 16h10" />
            </svg>
            Add lab section
          </button>
          <p v-else class="add-lab-confirm" role="status">
            Lab added — <strong>{{ labLabel }}</strong
            >. It's in the <strong>No meeting times</strong> strip; drag it onto a slot to schedule it.
          </p>
        </div>
      </div>
      <div class="modal-foot">
        <template v-if="confirmDiscard">
          <span class="field-hint">Discard your unsaved changes?</span>
          <span class="controls-spacer"></span>
          <button class="filter-btn danger" @click="discard">Discard</button>
          <button ref="keepEditEl" class="filter-btn primary" @click="keepEditing">Keep editing</button>
        </template>
        <template v-else>
          <button class="filter-btn remove-course-btn" @click="removeCourse">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            Remove course
          </button>
          <span class="controls-spacer"></span>
          <button class="filter-btn" @click="$emit('close')">Cancel</button>
          <button class="filter-btn primary" :disabled="!canSave" @click="save">Save changes</button>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import {
  WEEKDAYS,
  compareInstructors,
  instructorsOf,
  termConfig,
  termSlotOptions,
  normalizeBand,
  offeringCodeLabel,
  offeringSectionLabel,
  offeringItemKey,
} from '@major-vis/schedule-core'
import {
  scheduleById,
  updateOffering,
  removeCourseFromSchedule,
  addLabSection,
  activeTerm,
  editingRole,
  publishedPart,
} from '../src/scheduleStore.js'
import { courseName as catalogCourseName, programs, allCourses } from '@major-vis/catalog-client'
import { buildFacultyAndEligible } from '@major-vis/schedule-core/generate'
import { useModalFocus } from '../src/modalFocus.js'
import AirDatepicker from 'air-datepicker'
import 'air-datepicker/air-datepicker.css'

import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'

// Day letters available per term group (Spring is a single MTWRF group).
const GROUP_DAYS = { MWF: ['M', 'W', 'F'], TR: ['T', 'R'], MTWRF: ['M', 'T', 'W', 'R', 'F'] }

export default {
  name: 'ScheduleCourseEdit',
  props: {
    scheduleId: { type: String, required: true },
    offering: { type: Object, required: true },
    // Every section/lab of this course (merged `{ o, code, sid }` items) — the
    // header turns into a switcher when there is more than one. Switching saves
    // the section you are leaving (never discards it); an invalid form, which
    // cannot be saved, falls back to the discard ask.
    sections: { type: Array, default: () => [] },
  },
  emits: ['close', 'switch'],
  setup(props, { emit }) {
    const o = props.offering.o

    // The editor only exists while it's open (the parent gates it), so its
    // focus trap is always active for its lifetime.
    const modalEl = ref(null)
    const instructorEl = ref(null)

    // --- Section switcher ------------------------------------------------
    const offeringKey = computed(() => offeringItemKey(props.offering))
    const sectionOptionLabel = (s) => `${offeringCodeLabel(s.o)} · ${offeringSectionLabel(s.o)}`
    // The section a confirmed discard should switch to; null means "close".
    const discardTarget = ref(null)
    const onSwitch = (e) => {
      const target = props.sections.find((s) => offeringItemKey(s) === e.target.value)
      if (!target || offeringItemKey(target) === offeringKey.value) return
      if (hasPendingChanges.value) {
        // Leaving a section commits what you edited there — switching must
        // never throw work away. Only a form that cannot be saved (an
        // incomplete time pattern) falls back to the discard ask, and then the
        // header keeps showing the section actually being edited.
        if (canSave.value) {
          commit()
          emit('switch', target)
          return
        }
        e.target.value = offeringKey.value
        discardTarget.value = target
        confirmDiscard.value = true
        nextTick(() => {
          if (keepEditEl.value) keepEditEl.value.focus()
        })
        return
      }
      emit('switch', target)
    }

    // --- Guarded dismissal ---------------------------------------------
    // Closing the editor with unsaved changes (outside click, ×, Escape) asks
    // before discarding: the foot swaps to "Discard your unsaved changes?"
    // with Keep editing / Discard. Keep editing returns to the form (the lead
    // instructor field); Escape while confirming also keeps editing. Cancel,
    // Save, Remove course, and the lab auto-close are deliberate exits and
    // close directly. Switching sections does not discard — it commits; only
    // an unsavable form falls back to this ask (see `onSwitch`).
    const confirmDiscard = ref(false)
    const keepEditEl = ref(null)
    const close = () => {
      if (confirmDiscard.value) {
        keepEditing()
        return
      }
      if (hasPendingChanges.value) {
        discardTarget.value = null
        confirmDiscard.value = true
        nextTick(() => {
          if (keepEditEl.value) keepEditEl.value.focus()
        })
        return
      }
      emit('close')
    }
    const discard = () => {
      if (discardTarget.value) {
        const target = discardTarget.value
        discardTarget.value = null
        emit('switch', target)
        return
      }
      emit('close')
    }
    const keepEditing = () => {
      discardTarget.value = null
      confirmDiscard.value = false
      nextTick(() => {
        if (instructorEl.value) instructorEl.value.focus()
      })
    }
    useModalFocus(ref(true), modalEl, close)

    const schedule = computed(() => scheduleById(props.scheduleId))

    // Instructor dropdowns are drawn from the catalog faculty rosters
    // (per-program `faculty` lists, mapped to course prefixes the same way the
    // schedule generator does) plus the whole *term* the course is in — so a
    // brand-new schedule still offers the department's faculty, and names that
    // appear on the schedule are always pickable.
    const courseOfferings = computed(() => {
      const s = schedule.value
      const part = publishedPart(s, activeTerm.value)
      return part ? part.offerings : []
    })

    // prefix -> catalog faculty roster (the same map `generateSchedule` uses).
    const facultyByPrefix = computed(
      () => buildFacultyAndEligible(programs.value, allCourses.value).facultyByPrefix,
    )
    const allCatalogFaculty = computed(() =>
      [...new Set(Object.values(facultyByPrefix.value).flat())].sort(compareInstructors),
    )

    const deptInstructors = computed(() => {
      const set = new Set()
      for (const x of courseOfferings.value) {
        if (x.prefix !== o.prefix) continue
        for (const n of instructorsOf(x)) set.add(n)
      }
      return Array.from(set).sort(compareInstructors)
    })
    const allInstructors = computed(() => {
      const set = new Set()
      for (const x of courseOfferings.value) for (const n of instructorsOf(x)) set.add(n)
      return Array.from(set).sort(compareInstructors)
    })

    const deptOptions = computed(() =>
      [...new Set([...(facultyByPrefix.value[o.prefix] || []), ...deptInstructors.value])].sort(
        compareInstructors,
      ),
    )
    const allOptions = computed(() =>
      [...new Set([...allCatalogFaculty.value, ...allInstructors.value])].sort(compareInstructors),
    )

    const showAll = ref(o.instructor && !deptOptions.value.includes(o.instructor))

    const instructorSel = ref(o.instructor || '')
    const sectionSel = ref(o.section || '')

    // The lead-instructor combobox: free text (any name is legal — new hires,
    // adjuncts), with suggestions from the department pool (catalog roster +
    // same-prefix term instructors) or the all-instructors pool, matched
    // against the typed token.
    const instructorSuggestOpen = ref(false)
    const instructorSuggestEl = ref(null)
    const instructorSuggestions = computed(() => {
      if (!instructorSuggestOpen.value) return []
      const pool = showAll.value ? allOptions.value : deptOptions.value
      const token = instructorSel.value.trim().toLowerCase()
      const matched = token ? pool.filter((n) => n.toLowerCase().startsWith(token)) : pool
      return matched.slice(0, 8)
    })
    // Closes the suggestion list when focus leaves the input + list (clicking
    // an option is a mousedown.prevent, so the input keeps focus through click).
    const onInstructorBlur = (e) => {
      const next = e.relatedTarget
      if (next && instructorSuggestEl.value && instructorSuggestEl.value.contains(next)) return
      instructorSuggestOpen.value = false
    }
    const pickInstructor = (name) => {
      instructorSel.value = name
      instructorSuggestOpen.value = false
    }

    // --- Other instructors ------------------------------------------------
    // A free-text list mirroring the registrar's `secondary_instr` column
    // (comma-separated, whitespace tolerated), parsed on save. The autocomplete
    // dropdown suggests names from the same pools as the lead dropdown (the
    // whole term, minus the lead instructor and names already added), matched
    // against the last comma-separated token so "Smith, Jo" can become
    // "Smith, Jones" by picking a suggestion.
    const listKey = (names) =>
      [...new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean))].join(',')
    const secondaryText = ref((o.secondaryInstructors || []).join(', '))
    const secondaryNames = computed(() => [
      ...new Set(
        secondaryText.value
          .split(/,\s*/)
          .map((n) => n.trim())
          .filter(Boolean),
      ),
    ])
    const instructorPool = computed(() => {
      const lead = instructorSel.value
      return [...new Set([...deptOptions.value, ...allOptions.value])].filter((n) => n !== lead)
    })
    const suggestOpen = ref(false)
    const secondarySuggestEl = ref(null)
    const secondarySuggestions = computed(() => {
      if (!suggestOpen.value) return []
      const current = secondaryNames.value
      const text = secondaryText.value
      const token = text
        .slice(text.lastIndexOf(',') + 1)
        .trim()
        .toLowerCase()
      const pool = instructorPool.value.filter((n) => !current.includes(n))
      const matched = token ? pool.filter((n) => n.toLowerCase().startsWith(token)) : pool
      return matched.slice(0, 8)
    })
    // Closes the suggestion list when focus leaves the input + list (clicking
    // an option is a mousedown.prevent, so the input keeps focus through click).
    const onSecondaryBlur = (e) => {
      const next = e.relatedTarget
      if (next && secondarySuggestEl.value && secondarySuggestEl.value.contains(next)) return
      suggestOpen.value = false
    }
    // Replaces the partially-typed token with the picked name.
    const pickSecondary = (name) => {
      const text = secondaryText.value
      const i = text.lastIndexOf(',')
      secondaryText.value = (i < 0 ? '' : `${text.slice(0, i + 1)} `) + name
      suggestOpen.value = false
    }

    // --- Lab sections ----------------------------------------------------
    // A lab row mirrors its lecture's section letter. The editor opens for
    // labs too (to fix instructor/time); only non-lab rows get the "Add lab
    // section" action, since a lab without its lecture is meaningless.
    const isLab = computed(() => Boolean(o.lab))
    // Registrar-shaped identifiers (BIO 166 / BIO 166L, A / A2) — the title
    // names the offering exactly as the registrar writes it.
    const codeLabel = computed(() => offeringCodeLabel(o))
    const sectionLabel = computed(() => offeringSectionLabel(o))
    const labAdded = ref(null)
    const closeTimer = ref(null)

    // Creates the lab (unscheduled, mirroring the lecture's section letter
    // and copying its current instructor). Confirmation lives in the editor:
    // the button flips to a success note, and — when the user hadn't started
    // editing anything else — the editor closes itself after a beat, since
    // creating the lab was almost certainly the only reason they came here.
    const addLab = () => {
      if (labAdded.value || isLab.value) return
      const created = addLabSection(props.scheduleId, {
        prefix: o.prefix,
        number: o.number,
        section: o.section,
        id: o.id,
      })
      if (!created) return
      labAdded.value = created
      if (!hasPendingChanges.value) {
        closeTimer.value = setTimeout(() => emit('close'), 1200)
      }
    }

    const labLabel = computed(() => {
      const created = labAdded.value
      if (!created) return ''
      return `${props.offering.code}L ${created.section}${created.labSeq}`
    })

    // Whether any form field differs from the offering's current values (the
    // "pending changes" that keep the editor open after adding a lab). Matches
    // exactly what `save()` would write.
    const hasPendingChanges = computed(() => {
      const days = timeMode.value === 'none' ? '' : WEEKDAYS.filter((d) => daysSel.value.includes(d)).join('')
      const time =
        timeMode.value === 'none'
          ? ''
          : timeMode.value === 'custom'
            ? normalizeBand(`${snapToFive(customStart.value)}-${snapToFive(customEnd.value)}`)
            : timeSel.value
      return (
        instructorSel.value.trim() !== (o.instructor || '') ||
        listKey(secondaryNames.value) !== listKey(o.secondaryInstructors) ||
        (sectionSel.value.trim() || o.section) !== o.section ||
        days !== (o.days || '') ||
        time !== normalizeBand(o.time || '')
      )
    })

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
      if (timeGroupSel.value === label) return
      timeGroupSel.value = label
      // adopt the group's full day set when switching groups
      daysSel.value = [...GROUP_DAYS[label]]
      // a band from the other group is meaningless here — require an explicit pick
      timeSel.value = ''
    }
    const toggleDay = (d) => {
      const g = GROUP_DAYS[timeGroupSel.value]
      if (!g.includes(d)) return
      daysSel.value = daysSel.value.includes(d) ? daysSel.value.filter((x) => x !== d) : [...daysSel.value, d]
    }

    // Term slot bands for one day group, rendered next to that group's days
    // (incl. consecutive pairs in Spring). An existing off-pattern time
    // (imported custom band) stays selectable in its group so an untouched
    // course can be saved as-is; it just keeps the custom look.
    const slotsForGroup = (label) => {
      const day = (GROUP_DAYS[label] || 'M')[0]
      const base = termSlotOptions(activeTerm.value, day).map((s) => s.time)
      if (timeGroupSel.value === label && timeSel.value && !base.includes(timeSel.value)) {
        return [...base, timeSel.value]
      }
      return base
    }

    // Saving gives the course a real meeting pattern only when a time was
    // actually chosen for the selected day group and at least one day is on.
    const canSave = computed(() => {
      if (timeMode.value === 'none') return true
      if (!daysSel.value.length) return false
      if (timeMode.value === 'custom') return Boolean(customStart.value && customEnd.value)
      return Boolean(timeSel.value && slotsForGroup(timeGroupSel.value).includes(timeSel.value))
    })

    // Custom times snap to five-minute steps (00/05/…/55): the native picker
    // steps by 5 (step="300") and typed values are rounded on change and again
    // at save, so an off-step minute can never be written from the UI.
    const snapToFive = (v) => {
      if (!v) return ''
      const [h, m] = v.split(':').map(Number)
      const snapped = Math.round(m / 5) * 5
      const nh = (h + Math.floor(snapped / 60)) % 24
      return `${String(nh).padStart(2, '0')}:${String(snapped % 60).padStart(2, '0')}`
    }

    // Manual typing is snapped to five minutes like picker selections.
    const onStartTimeInput = (e) => {
      customStart.value = snapToFive(/** @type {HTMLInputElement} */ (e.target).value)
    }
    const onEndTimeInput = (e) => {
      customEnd.value = snapToFive(/** @type {HTMLInputElement} */ (e.target).value)
    }

    // --- Custom-time pickers (Air Datepicker, time-only) ----------------
    // The popover's two sliders step minutes by 5 (dragging or arrow keys can
    // only land on 00/05/…/55) — the native time input has no way to filter
    // its minute list. Type-in still works and is snapped by `snapToFive`.
    const startTimeEl = ref(null)
    const endTimeEl = ref(null)
    const startPicker = ref(null)
    const endPicker = ref(null)

    const timeToDate = (hhmm) => {
      const [h, m] = (hhmm || '').split(':').map(Number)
      const d = new Date(2020, 0, 1)
      if (!Number.isNaN(h) && !Number.isNaN(m)) d.setHours(h, m, 0, 0)
      return d
    }
    const attachTimePicker = (el, initial, onPick) =>
      new AirDatepicker(el, {
        timepicker: true,
        onlyTimepicker: true,
        minutesStep: 5,
        timeFormat: 'HH:mm',
        dateFormat: 'HH:mm',
        autoClose: true,
        selectedDates: [timeToDate(initial)],
        onSelect: ({ formattedDate }) => onPick(snapToFive(formattedDate)),
      })

    // The custom-time inputs only exist while timeMode is 'custom', so the
    // pickers attach/detach with the mode (the modal can open directly into
    // any mode, and customStart may carry a value from a previous session).
    watch(
      timeMode,
      (mode) => {
        if (mode === 'custom') {
          if (startTimeEl.value && !startPicker.value) {
            startPicker.value = attachTimePicker(startTimeEl.value, customStart.value, (v) => {
              customStart.value = v
            })
          }
          if (endTimeEl.value && !endPicker.value) {
            endPicker.value = attachTimePicker(endTimeEl.value, customEnd.value, (v) => {
              customEnd.value = v
            })
          }
        }
      },
      { immediate: true, flush: 'post' },
    )
    onBeforeUnmount(() => {
      if (closeTimer.value) clearTimeout(closeTimer.value)
      if (startPicker.value) startPicker.value.destroy()
      if (endPicker.value) endPicker.value.destroy()
    })

    const timeHint = computed(() => {
      if (timeMode.value === 'none') return ''
      if (timeMode.value === 'slot' && !timeSel.value) return `Pick a time slot for ${timeGroupSel.value}.`
      if (!daysSel.value.length) return 'Pick at least one day.'
      return ''
    })

    const courseName = computed(() => catalogCourseName(props.offering.code))
    const termLabel = computed(() => termConfig(activeTerm.value).label)

    // Writes the form's current values to the offering (directly, or into the
    // suggest draft). Shared by Save and by switching sections.
    const commit = () => {
      let days = o.days || ''
      let time = o.time || ''
      if (timeMode.value === 'none') {
        days = ''
        time = ''
      } else if (timeMode.value === 'custom') {
        days = WEEKDAYS.filter((d) => daysSel.value.includes(d)).join('')
        time = normalizeBand(`${snapToFive(customStart.value)}-${snapToFive(customEnd.value)}`)
      } else {
        days = WEEKDAYS.filter((d) => daysSel.value.includes(d)).join('')
        time = timeSel.value
      }
      updateOffering(
        props.scheduleId,
        { prefix: o.prefix, number: o.number, section: o.section, lab: o.lab, labSeq: o.labSeq, id: o.id },
        {
          instructor: instructorSel.value.trim(),
          secondaryInstructors: [...secondaryNames.value],
          section: sectionSel.value.trim() || o.section,
          days,
          time,
        },
      )
    }

    const save = () => {
      if (!canSave.value) return
      commit()
      emit('close')
    }

    const removeCourse = () => {
      removeCourseFromSchedule(props.scheduleId, {
        prefix: o.prefix,
        number: o.number,
        section: o.section,
        lab: o.lab,
        labSeq: o.labSeq,
        id: o.id,
      })
      emit('close')
    }

    return {
      schedule,
      showAll,
      modalEl,
      offeringKey,
      sectionOptionLabel,
      onSwitch,
      offeringItemKey,
      instructorSel,
      instructorSuggestOpen,
      instructorSuggestEl,
      instructorSuggestions,
      onInstructorBlur,
      pickInstructor,
      secondaryText,
      secondaryNames,
      instructorPool,
      suggestOpen,
      secondarySuggestEl,
      secondarySuggestions,
      onSecondaryBlur,
      pickSecondary,
      sectionSel,
      isLab,
      codeLabel,
      sectionLabel,
      labAdded,
      labLabel,
      addLab,
      hasPendingChanges,
      confirmDiscard,
      keepEditEl,
      close,
      keepEditing,
      discard,
      timeMode,
      timeSel,
      slotsForGroup,
      dayGroups,
      daysSel,
      timeGroupSel,
      pickGroup,
      toggleDay,
      customStart,
      customEnd,
      onStartTimeInput,
      onEndTimeInput,
      snapToFive,
      startTimeEl,
      endTimeEl,
      canSave,
      timeHint,
      save,
      removeCourse,
      courseName,
      termLabel,
      activeTerm,
      editingRole,
      GROUP_DAYS,
    }
  },
}
</script>
