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
        <p v-if="canEdit" class="modal-intro">
          Editing this offering in <strong>{{ schedule.name }}</strong> ({{ termLabel }}).
          <template v-if="editingRole === 'suggest'"
            >These changes are collected into a proposal for the owner; nothing is written to the schedule
            until it's approved.</template
          >
          <template v-else>Any changes are saved to this schedule in your browser.</template>
        </p>
        <p v-else class="modal-intro">
          This cross-listed version is maintained by <strong>{{ crossState && crossState.owner }}</strong
          >. You can remove your listing, but only the owning department edits it.
        </p>

        <template v-if="canEdit">
          <div class="field-row">
            <div class="field">
              <label for="course-edit-offering-title">Title</label>
              <input
                id="course-edit-offering-title"
                class="search-input"
                type="text"
                v-model="titleSel"
                :disabled="isLab"
                :placeholder="courseName"
              />
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

            <div class="field field-fit">
              <label for="course-edit-seats">Seats</label>
              <input
                id="course-edit-seats"
                class="search-input"
                type="number"
                min="1"
                step="1"
                v-model.number="seatsSel"
                placeholder="24"
              />
            </div>
          </div>
          <p class="field-hint">
            <template v-if="isLab"
              >Labs share their lecture's title — edit it on the lecture section.</template
            >
            <template v-else>Leave blank to use the catalog name ({{ courseName }}).</template>
          </p>

          <div class="field-row">
            <div class="field">
              <label for="course-edit-instructor">Instructor</label>
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
                    v-for="opt in instructorSuggestions"
                    :key="opt.value"
                    type="button"
                    class="course-picker-option"
                    :title="opt.value"
                    :aria-label="opt.value === opt.label ? opt.label : opt.label + ' (' + opt.value + ')'"
                    @mousedown.prevent
                    @click="pickInstructor(opt)"
                  >
                    <span class="planner-pick-code">{{ opt.label }}</span>
                  </button>
                  <button
                    type="button"
                    class="course-picker-scope link-toggle"
                    @mousedown.prevent
                    @click="showAll = !showAll"
                  >
                    {{ showAll ? 'Limit to department' : 'Show all instructors' }}
                  </button>
                </div>
              </div>
            </div>

            <div class="field">
              <template v-if="secondaryOpen">
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
                      v-for="opt in secondarySuggestions"
                      :key="opt.value"
                      type="button"
                      class="course-picker-option"
                      :title="opt.value"
                      :aria-label="opt.value === opt.label ? opt.label : opt.label + ' (' + opt.value + ')'"
                      @mousedown.prevent
                      @click="pickSecondary(opt)"
                    >
                      <span class="planner-pick-code">{{ opt.label }}</span>
                    </button>
                  </div>
                </div>
              </template>
              <template v-else>
                <span class="field-label">Other instructors</span>
                <button
                  type="button"
                  class="filter-btn add-others-btn"
                  aria-label="Add other instructors"
                  @click="secondaryOpen = true"
                >
                  ＋ Add
                </button>
              </template>
            </div>
          </div>
          <p v-if="secondaryOpen" class="field-hint">Comma-separated; leave blank for none.</p>

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

          <p v-if="hasSiblings" class="field-hint meeting-siblings">
            This section also meets:
            <button
              v-for="sib in siblingMeetings"
              :key="offeringItemKey(sib.item)"
              type="button"
              class="link-toggle meeting-sibling-link"
              @click="requestSwitch(sib.item)"
            >
              {{ sib.label }}
            </button>
          </p>

          <div v-if="!isLab" class="add-lab-row">
            <button class="filter-btn add-lab-btn" @click="addLab">
              <IconFlaskConical :size="13" :stroke-width="2.2" />
              Add lab section
            </button>
            <button class="filter-btn add-meeting-btn" @click="addMeeting">
              ＋ Add another meeting time
            </button>
          </div>
        </template>

        <div v-if="crossState && crossState.crossListed" class="cross-list-block">
          <p class="field-hint">
            <strong>Cross-listed:</strong>
            {{ crossState.otherCodes.join(', ') }}
            <template v-if="crossState.owner"> · maintained by {{ crossState.owner }}</template>
            <template v-else> · no owner yet — your next edit claims maintenance</template>
          </p>
          <p v-if="crossState.missing.length" class="field-hint">
            Not listed this term: {{ crossState.missing.join(', ') }}.
          </p>
          <button v-if="canMaterialize" class="filter-btn" @click="createVersions">
            Create cross-listed versions
          </button>
          <p v-if="materializeFeedback" class="field-hint" role="status">{{ materializeFeedback }}</p>
          <p v-if="canEdit" class="field-hint">
            Changes to time, instructors, or seats apply to every version.
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
          <button v-if="canRemove" class="filter-btn remove-course-btn" @click="removeCourse">
            <IconTrash2 :size="13" :stroke-width="2.2" />
            {{ removeLabel }}
          </button>
          <span class="controls-spacer"></span>
          <button class="filter-btn" @click="$emit('close')">{{ canEdit ? 'Cancel' : 'Close' }}</button>
          <button v-if="canEdit" class="filter-btn primary" :disabled="!canSave" @click="save">
            Save changes
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import {
  WEEKDAYS,
  termConfig,
  termSlotOptions,
  normalizeBand,
  offeringCodeLabel,
  offeringSectionLabel,
  offeringItemKey,
  formatTime,
  DEFAULT_SEATS,
} from '@major-vis/schedule-core'
import {
  scheduleById,
  updateOffering,
  removeCourseFromSchedule,
  addLabSection,
  addMeetingToSchedule,
  materializeCrossListVersions,
  crossListState,
  canTouchOffering,
  activeTerm,
  editingRole,
  publishedPart,
  directoryIndex,
  instructorValue,
} from '../src/scheduleStore.js'
import { courseName as catalogCourseName, programs, allCourses } from '@major-vis/catalog-client'
import { buildFacultyAndEligible } from '@major-vis/schedule-core/generate'
import { instructorLabel } from '../src/names.js'
import { buildInstructorOptions } from '../src/instructorSuggest.js'
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
    // The meeting a row shows, compactly, for the switcher option and the
    // sibling indicator (`MW · 9:20 AM - 10:30 AM`, or `No meeting time`).
    const meetingLabel = (row) =>
      row.days && row.time ? `${row.days} · ${formatTime(row.time)}` : 'No meeting time'
    const sectionOptionLabel = (s) =>
      `${offeringCodeLabel(s.o)} · ${offeringSectionLabel(s.o)} · ${meetingLabel(s.o)}`
    // The other meeting rows of this same section (split meetings): what this
    // form is not editing, shown so a user knows the section carries more than
    // one meeting and can jump to it. A lab has no meeting siblings — its
    // letter mirrors the lecture's, which is a different row, not a second
    // meeting of the lab.
    const siblingMeetings = computed(() => {
      if (o.lab) return []
      const sections = /** @type {Array<any>} */ (props.sections || [])
      return sections
        .filter((s) => offeringItemKey(s) !== offeringKey.value && !s.o.lab && s.o.section === o.section)
        .map((s) => ({ item: s, label: meetingLabel(s.o) }))
    })
    const hasSiblings = computed(() => siblingMeetings.value.length > 0)
    // The section a confirmed discard should switch to; null means "close".
    const discardTarget = ref(null)
    // Switches the editor to `target` (a merged item), committing this form's
    // edits first when it can be saved; an unsavable form falls back to the
    // discard ask and keeps showing the section actually being edited. Returns
    // false when the switch was deferred to the ask.
    const requestSwitch = (target) => {
      if (!target || offeringItemKey(target) === offeringKey.value) return true
      if (hasPendingChanges.value) {
        if (canSave.value) {
          commit()
          emit('switch', target)
          return true
        }
        discardTarget.value = target
        confirmDiscard.value = true
        nextTick(() => {
          if (keepEditEl.value) keepEditEl.value.focus()
        })
        return false
      }
      emit('switch', target)
      return true
    }
    const onSwitch = (e) => {
      const target = props.sections.find((s) => offeringItemKey(s) === e.target.value)
      if (!requestSwitch(target)) e.target.value = offeringKey.value
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

    // Permission for this row in the active session: a non-owner's suggest
    // session may edit its own department's (or the group it owns) versions; a
    // member of an owned cross-list group may only remove its own version, in
    // which case the editor opens read-only.
    const cur = {
      prefix: o.prefix,
      number: o.number,
      section: o.section,
      lab: o.lab,
      labSeq: o.labSeq,
      id: o.id,
    }
    const canEdit = computed(() => canTouchOffering(props.scheduleId, o, 'edit'))
    const canRemove = computed(() => canTouchOffering(props.scheduleId, o, 'remove'))
    // The cross-listing picture for this offering (other codes, present/missing
    // versions, owner), or null for a plain course.
    const crossState = computed(() => crossListState(props.scheduleId, cur))
    const canMaterialize = computed(
      () =>
        canEdit.value &&
        crossState.value &&
        crossState.value.crossListed &&
        crossState.value.missing.length > 0,
    )
    const materializeFeedback = ref('')
    const createVersions = () => {
      if (!canMaterialize.value) return
      const created = materializeCrossListVersions(props.scheduleId, cur)
      materializeFeedback.value = created.length
        ? `Created ${created.map((x) => `${x.prefix} ${x.number}`).join(', ')}.`
        : 'Nothing to create.'
    }
    // Removing the group owner's own version takes the whole group with it.
    const isOwnerRow = computed(
      () => Boolean(crossState.value) && crossState.value.owner === String(o.prefix || '').toUpperCase(),
    )
    const removeLabel = computed(() => {
      // A split-meeting row removes just its own band (mirrored across the
      // group's versions); an only meeting removes the course/group.
      if (hasSiblings.value) return 'Remove this meeting time'
      return isOwnerRow.value ? 'Remove all versions' : 'Remove course'
    })

    // Instructor dropdowns are drawn from the catalog faculty rosters
    // (per-program `faculty` lists, mapped to course prefixes the same way the
    // schedule generator does) plus the whole *term* the course is in — so a
    // brand-new schedule still offers the department's faculty, and names that
    // appear on the schedule are always pickable. The pool builder is shared
    // with the table view's inline instructor cell (`src/instructorSuggest.js`).
    const courseOfferings = computed(() => {
      const s = schedule.value
      const part = publishedPart(s, activeTerm.value)
      return part ? part.offerings : []
    })

    // prefix -> catalog faculty roster (the same map `generateSchedule` uses).
    const facultyByPrefix = computed(
      () => buildFacultyAndEligible(programs.value, allCourses.value).facultyByPrefix,
    )

    const instructorPools = computed(() =>
      buildInstructorOptions({
        prefix: o.prefix,
        facultyByPrefix: facultyByPrefix.value,
        termOfferings: courseOfferings.value,
        directoryIndex: directoryIndex.value,
      }),
    )
    const deptOptions = computed(() => instructorPools.value.deptOptions)
    const allOptions = computed(() => instructorPools.value.allOptions)

    const showAll = ref(
      Boolean(o.instructor) && !deptOptions.value.some((e) => e.value === instructorValue(o.instructor)),
    )

    const instructorSel = ref(instructorLabel(o.instructor, directoryIndex.value))
    const sectionSel = ref(o.section || '')
    // The offering's own title ('' = fall back to the catalog name). A lab
    // shares its lecture's title, so its field is disabled.
    const titleSel = ref(o.title || '')
    // The requested seat count for this offering (each row — lecture or lab —
    // carries its own). Blank/invalid input falls back to the model default.
    const seatsSel = ref(o.seats ?? DEFAULT_SEATS)
    const seatsValue = computed(() => {
      const n = Number.parseInt(seatsSel.value, 10)
      return Number.isInteger(n) && n > 0 ? n : DEFAULT_SEATS
    })

    // The lead-instructor combobox: free text (any name is legal — new hires,
    // adjuncts), with suggestions from the department pool (directory people +
    // catalog roster + same-prefix term instructors) or the all-instructors
    // pool, matched against the typed token (a full name or a username).
    const instructorSuggestOpen = ref(false)
    const instructorSuggestEl = ref(null)
    const instructorSuggestions = computed(() => {
      if (!instructorSuggestOpen.value) return []
      const pool = showAll.value ? allOptions.value : deptOptions.value
      const token = instructorSel.value.trim().toLowerCase()
      const matched = token
        ? pool.filter(
            (e) => e.label.toLowerCase().startsWith(token) || e.value.toLowerCase().startsWith(token),
          )
        : pool
      return matched.slice(0, 8)
    })
    // Closes the suggestion list when focus leaves the input + list (clicking
    // an option is a mousedown.prevent, so the input keeps focus through click).
    const onInstructorBlur = (e) => {
      const next = e.relatedTarget
      if (next && instructorSuggestEl.value && instructorSuggestEl.value.contains(next)) return
      instructorSuggestOpen.value = false
    }
    const pickInstructor = (entry) => {
      instructorSel.value = entry.label
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
    // The field shows resolved full names; each entry is canonicalized to its
    // stored value on save (see `commit`).
    const secondaryText = ref(
      (o.secondaryInstructors || []).map((n) => instructorLabel(n, directoryIndex.value)).join(', '),
    )
    // Most courses have no co-teachers, so the field stays collapsed behind a
    // trigger unless this offering already has some (or the user expands it).
    const secondaryOpen = ref(Boolean((o.secondaryInstructors || []).length))
    const secondaryNames = computed(() => [
      ...new Set(
        secondaryText.value
          .split(/,\s*/)
          .map((n) => n.trim())
          .filter(Boolean),
      ),
    ])
    // The picker pool: both scopes, minus the lead instructor and the names
    // already listed (keyed on the canonical value, so a full name and its
    // username never both appear).
    const instructorPool = computed(() => {
      const lead = instructorValue(instructorSel.value)
      const current = secondaryNames.value.map(instructorValue)
      const out = []
      const seen = new Set()
      for (const e of [...deptOptions.value, ...allOptions.value]) {
        if (e.value === lead || current.includes(e.value) || seen.has(e.value)) continue
        seen.add(e.value)
        out.push(e)
      }
      return out
    })
    const suggestOpen = ref(false)
    const secondarySuggestEl = ref(null)
    const secondarySuggestions = computed(() => {
      if (!suggestOpen.value) return []
      const text = secondaryText.value
      const token = text
        .slice(text.lastIndexOf(',') + 1)
        .trim()
        .toLowerCase()
      const pool = instructorPool.value
      const matched = token
        ? pool.filter(
            (e) => e.label.toLowerCase().startsWith(token) || e.value.toLowerCase().startsWith(token),
          )
        : pool
      return matched.slice(0, 8)
    })
    // Closes the suggestion list when focus leaves the input + list (clicking
    // an option is a mousedown.prevent, so the input keeps focus through click).
    const onSecondaryBlur = (e) => {
      const next = e.relatedTarget
      if (next && secondarySuggestEl.value && secondarySuggestEl.value.contains(next)) return
      suggestOpen.value = false
    }
    // Replaces the partially-typed token with the picked label.
    const pickSecondary = (entry) => {
      const text = secondaryText.value
      const i = text.lastIndexOf(',')
      secondaryText.value = (i < 0 ? '' : `${text.slice(0, i + 1)} `) + entry.label
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

    // Creates the lab (unscheduled, mirroring the lecture's section letter and
    // copying its instructor) and switches the editor to it, so the user can
    // give it a time right away — a lab's meeting time is set in the editor,
    // not by dragging (the grid is behind the modal). Mirrors `addMeeting`:
    // this form's edits are committed first so the lab copies the section's
    // latest content, and an unsavable form blocks the add.
    const addLab = () => {
      if (isLab.value) return
      if (hasPendingChanges.value) {
        if (!canSave.value) return
        commit()
      }
      const created = addLabSection(props.scheduleId, {
        prefix: o.prefix,
        number: o.number,
        section: o.section,
        id: o.id,
      })
      if (!created) return
      emit('switch', { o: created, code: offeringCodeLabel(created), sid: props.scheduleId })
    }

    // Adds another meeting band to this section as a same-section sibling row
    // (split meetings: e.g. MW at one time, R at another). This form's edits are
    // committed first so the new row copies the section's latest content; then
    // the editor switches to the new (unscheduled) row to set its days/time.
    const addMeeting = () => {
      if (isLab.value) return
      if (hasPendingChanges.value) {
        if (!canSave.value) return
        commit()
      }
      const created = addMeetingToSchedule(props.scheduleId, {
        prefix: o.prefix,
        number: o.number,
        section: o.section,
        id: o.id,
      })
      if (!created) return
      emit('switch', { o: created, code: offeringCodeLabel(created), sid: props.scheduleId })
    }

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
        (!isLab.value && titleSel.value.trim() !== (o.title || '')) ||
        instructorValue(instructorSel.value) !== instructorValue(o.instructor) ||
        listKey(secondaryNames.value.map(instructorValue)) !==
          listKey((o.secondaryInstructors || []).map(instructorValue)) ||
        (sectionSel.value.trim() || o.section) !== o.section ||
        days !== (o.days || '') ||
        time !== normalizeBand(o.time || '') ||
        seatsValue.value !== (o.seats ?? DEFAULT_SEATS)
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
      // A lab shares its lecture's title, so its disabled field is never
      // committed — only a lecture's title is written (and cascades to labs).
      updateOffering(
        props.scheduleId,
        { prefix: o.prefix, number: o.number, section: o.section, lab: o.lab, labSeq: o.labSeq, id: o.id },
        {
          instructor: instructorValue(instructorSel.value),
          secondaryInstructors: secondaryNames.value.map(instructorValue),
          section: sectionSel.value.trim() || o.section,
          days,
          time,
          seats: seatsValue.value,
          ...(isLab.value ? {} : { title: titleSel.value.trim() }),
        },
      )
    }

    const save = () => {
      if (!canSave.value) return
      commit()
      emit('close')
    }

    const removeCourse = () => {
      if (
        !hasSiblings.value &&
        isOwnerRow.value &&
        crossState.value &&
        crossState.value.present.length &&
        !window.confirm(
          `Removing this version also removes the other cross-listed versions (${crossState.value.present.join(', ')}). Continue?`,
        )
      ) {
        return
      }
      // When this row is one of several meetings, keep the editor open on the
      // remaining meeting instead of closing it.
      const survivor = siblingMeetings.value[0] ? siblingMeetings.value[0].item : null
      const removed = removeCourseFromSchedule(props.scheduleId, {
        prefix: o.prefix,
        number: o.number,
        section: o.section,
        lab: o.lab,
        labSeq: o.labSeq,
        id: o.id,
      })
      if (!removed) return
      if (survivor) emit('switch', survivor)
      else emit('close')
    }

    return {
      schedule,
      showAll,
      modalEl,
      offeringKey,
      sectionOptionLabel,
      onSwitch,
      requestSwitch,
      siblingMeetings,
      hasSiblings,
      offeringItemKey,
      instructorSel,
      instructorSuggestOpen,
      instructorSuggestEl,
      instructorSuggestions,
      onInstructorBlur,
      pickInstructor,
      secondaryText,
      secondaryNames,
      secondaryOpen,
      instructorPool,
      suggestOpen,
      secondarySuggestEl,
      secondarySuggestions,
      onSecondaryBlur,
      pickSecondary,
      sectionSel,
      seatsSel,
      titleSel,
      isLab,
      codeLabel,
      sectionLabel,
      addLab,
      addMeeting,
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
      canEdit,
      canRemove,
      removeLabel,
      crossState,
      canMaterialize,
      materializeFeedback,
      createVersions,
      courseName,
      termLabel,
      activeTerm,
      editingRole,
      GROUP_DAYS,
    }
  },
}
</script>
