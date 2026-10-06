<template>
  <div v-if="props.isOpen" class="modal-overlay" @click.self="close">
    <div
      ref="modalEl"
      class="modal modal-wide"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-copy-title"
    >
      <div class="modal-head">
        <h3 id="schedule-copy-title">Copy courses into {{ editingName }}</h3>
        <button class="modal-close" @click="close" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p v-if="step === 'choose'" class="modal-intro">
          Copy another schedule's {{ termLabel }} courses into this one. Pick the source and departments, then
          review the courses before copying. Matching sections are <strong>updated</strong> to the source;
          missing ones are added. Switch term to copy a different term.
        </p>
        <p v-else class="modal-intro">
          Untick any course you do not want to bring over. Matching sections are
          <strong>updated</strong> to the source; missing ones are added.
        </p>

        <div v-if="!sourceSchedules.length" class="schedule-manage-empty">
          There is no other schedule to copy from.
        </div>

        <template v-else>
          <template v-if="step === 'choose'">
            <div class="field">
              <label for="schedule-copy-source">Source schedule</label>
              <select id="schedule-copy-source" class="search-input" v-model="sourceId">
                <option v-for="s in sourceSchedules" :key="s.id" :value="s.id">
                  {{ s.name }}{{ s.year ? ' · ' + s.year : '' }}
                </option>
              </select>
            </div>

            <div v-if="prefixOptions.length" class="field">
              <span class="field-label">Departments</span>
              <div class="schedule-copy-prefixes">
                <button
                  v-for="p in prefixOptions"
                  :key="p"
                  type="button"
                  class="filter-btn"
                  :class="{ active: prefixes.includes(p) }"
                  :aria-pressed="prefixes.includes(p)"
                  @click="togglePrefix(p)"
                >
                  {{ p }}
                </button>
              </div>
              <label class="schedule-copy-siblings" for="schedule-copy-siblings">
                <input id="schedule-copy-siblings" type="checkbox" v-model="includeSiblings" />
                Include cross-listed versions
              </label>
            </div>
          </template>

          <template v-else>
            <div v-if="!candidates.length" class="schedule-manage-empty">
              No courses match the selected departments.
            </div>
            <template v-else>
              <div class="schedule-copy-list-head">
                <span class="schedule-copy-list-count" role="status">
                  {{ selectedKeys.length }} of {{ candidates.length }} selected
                </span>
                <button type="button" class="filter-btn" @click="selectAll">Select all</button>
                <button type="button" class="filter-btn" @click="deselectAll">Deselect all</button>
              </div>
              <ul class="schedule-copy-list">
                <li v-for="(c, i) in candidates" :key="c.key" class="schedule-copy-item">
                  <label class="schedule-copy-item-main" :for="`schedule-copy-item-${i}`">
                    <input
                      :id="`schedule-copy-item-${i}`"
                      type="checkbox"
                      :checked="selectedKeySet.has(c.key)"
                      @change="toggleKey(c.key)"
                    />
                    <span class="schedule-copy-item-text">
                      <span class="schedule-copy-item-code"
                        >{{ c.code }}<template v-if="c.section"> {{ c.section }}</template></span
                      >
                      <span v-if="c.title" class="schedule-copy-item-title">{{ c.title }}</span>
                      <span class="schedule-copy-item-meta">{{ candidateMeta(c) }}</span>
                    </span>
                    <span class="schedule-copy-badge" :class="`is-${c.action}`">{{
                      actionLabel(c.action)
                    }}</span>
                  </label>
                </li>
              </ul>
            </template>
          </template>

          <div class="schedule-copy-summary" role="status">
            <p class="schedule-copy-counts">
              <strong>{{ plan.added }}</strong> new · <strong>{{ plan.updated }}</strong> updated<span
                v-if="plan.unchanged"
              >
                · {{ plan.unchanged }} unchanged</span
              >
              <template v-if="!plan.rows && step === 'choose'">
                — no rows match the selected departments.</template
              >
            </p>
            <p v-if="plan.orphans.length" class="schedule-upload-warning">
              <strong>{{ plan.orphans.length }} lab row(s) without their lecture</strong> in the selection:
              <span v-for="l in plan.orphans" :key="l" class="schedule-upload-warning-item">{{ l }}</span>
            </p>
            <p v-if="plan.outside.length" class="schedule-upload-warning">
              <strong>Outside your departments</strong> (the proposal would be refused):
              <span v-for="c in plan.outside" :key="c" class="schedule-upload-warning-item">{{ c }}</span>
            </p>
          </div>
        </template>

        <div class="controls">
          <span class="controls-spacer"></span>
          <button v-if="step === 'review'" class="filter-btn" @click="goChoose">← Back</button>
          <button class="filter-btn" @click="close">Cancel</button>
          <button
            v-if="step === 'choose'"
            class="filter-btn primary"
            :disabled="!canReview"
            @click="goReview"
          >
            Review {{ candidates.length }} course{{ candidates.length === 1 ? '' : 's' }}
          </button>
          <button v-else class="filter-btn primary" :disabled="!canApply" @click="apply">
            {{ applyLabel }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// "Copy courses into <schedule>" modal: a two-step wizard over a bulk copy of
// another schedule's active-term offerings. Step one picks the source and the
// departments (prefixes) to carry over; step two lists every candidate row with
// a checkbox so the user can untick individual courses (or Select all / Deselect
// all), each tagged with whether the copy will add or update it. Confirming
// writes through the store's `copyCoursesInto` — a direct edit for the owner, or
// the suggest draft for a proposer (where the server still enforces the
// department scope). Visibility via the `isOpen` prop.
import {
  schedules,
  editingSchedule,
  activeTerm,
  myDepartments,
  planCourseCopy,
  copyCoursesInto,
} from '../src/scheduleStore.js'
import { TERM_LABELS } from '@major-vis/schedule-core'
import { useModalFocus } from '../src/modalFocus.js'

import { ref, computed, watch } from 'vue'

const EMPTY_PLAN = {
  added: 0,
  updated: 0,
  unchanged: 0,
  rows: 0,
  candidates: [],
  orphans: [],
  outside: [],
  offerings: null,
}

export default {
  name: 'ScheduleCopyCourses',
  props: {
    isOpen: { type: Boolean, default: false },
    scheduleId: { type: [String, Number], default: null },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const modalEl = ref(null)
    const sourceId = ref(null)
    const prefixes = ref([])
    const includeSiblings = ref(false)
    const step = ref('choose')
    const selectedKeys = ref([])

    const editingName = computed(() => (editingSchedule.value ? editingSchedule.value.name : ''))
    const termLabel = computed(() => TERM_LABELS[activeTerm.value] || activeTerm.value)
    const sourceSchedules = computed(() =>
      schedules.value.filter((s) => String(s.id) !== String(props.scheduleId)),
    )
    const sourceOfferings = computed(() => {
      const s = schedules.value.find((x) => String(x.id) === String(sourceId.value))
      const part = s && s.terms && s.terms[activeTerm.value]
      return (part && part.offerings) || []
    })
    const prefixOptions = computed(() => {
      const set = new Set()
      for (const o of sourceOfferings.value) set.add(String(o.prefix || '').toUpperCase())
      return [...set].filter(Boolean).sort()
    })

    // Step one previews every candidate; step two previews only the ticked
    // rows. `candidates` is the full filtered list either way (the store never
    // narrows it by selection), so the review list stays complete as the user
    // untick rows.
    const plan = computed(() => {
      if (!props.scheduleId || !sourceId.value) return EMPTY_PLAN
      const opts = { prefixes: prefixes.value, includeSiblings: includeSiblings.value }
      if (step.value === 'review') opts.selectedKeys = selectedKeys.value
      return planCourseCopy(props.scheduleId, sourceId.value, opts)
    })
    const candidates = computed(() => plan.value.candidates)
    const selectedKeySet = computed(() => new Set(selectedKeys.value))

    // The modal stays mounted between opens, so reset its scope on open: the
    // first source, no cross-list siblings, the user's own departments when the
    // source carries them (else every department present), back to step one.
    const reset = () => {
      const first = sourceSchedules.value[0]
      sourceId.value = first ? first.id : null
      includeSiblings.value = false
      const mine = myDepartments.value.map((d) => String(d).toUpperCase())
      const opts = prefixOptions.value
      const own = opts.filter((p) => mine.includes(p))
      prefixes.value = own.length ? own : [...opts]
      step.value = 'choose'
      selectedKeys.value = []
    }
    watch(
      () => props.isOpen,
      (open) => {
        if (open) reset()
      },
    )
    // Keep the selected departments valid when the source changes.
    watch(sourceId, () => {
      const opts = prefixOptions.value
      const kept = prefixes.value.filter((p) => opts.includes(p))
      prefixes.value = kept.length ? kept : [...opts]
    })

    const canReview = computed(() => candidates.value.length > 0)
    const canApply = computed(
      () => Boolean(plan.value.offerings) && plan.value.added + plan.value.updated > 0,
    )
    const applyLabel = computed(() => {
      const n = plan.value.added + plan.value.updated
      return n ? `Copy ${n} course${n === 1 ? '' : 's'}` : 'Copy'
    })
    const togglePrefix = (p) => {
      prefixes.value = prefixes.value.includes(p)
        ? prefixes.value.filter((x) => x !== p)
        : [...prefixes.value, p]
    }
    // Entering the review step starts with every candidate ticked; changing the
    // filters sends the user back to step one, where the next review re-selects.
    const goReview = () => {
      if (!canReview.value) return
      selectedKeys.value = candidates.value.map((c) => c.key)
      step.value = 'review'
    }
    const goChoose = () => {
      step.value = 'choose'
    }
    const selectAll = () => {
      selectedKeys.value = candidates.value.map((c) => c.key)
    }
    const deselectAll = () => {
      selectedKeys.value = []
    }
    const toggleKey = (key) => {
      selectedKeys.value = selectedKeySet.value.has(key)
        ? selectedKeys.value.filter((k) => k !== key)
        : [...selectedKeys.value, key]
    }
    const actionLabel = (action) =>
      action === 'added' ? 'new' : action === 'updated' ? 'update' : 'no change'
    const candidateMeta = (c) => {
      const when = c.days || c.time ? `${c.days} ${c.time}`.trim() : 'No meeting time'
      return [c.instructor, when].filter(Boolean).join(' · ')
    }
    const apply = () => {
      if (!canApply.value) return
      const res = copyCoursesInto(props.scheduleId, {
        sourceId: sourceId.value,
        prefixes: prefixes.value,
        includeSiblings: includeSiblings.value,
        selectedKeys: selectedKeys.value,
      })
      if (res) emit('close')
    }
    const close = () => emit('close')
    useModalFocus(() => props.isOpen, modalEl, close)

    return {
      props,
      modalEl,
      sourceSchedules,
      sourceId,
      prefixOptions,
      prefixes,
      includeSiblings,
      togglePrefix,
      step,
      selectedKeys,
      selectedKeySet,
      candidates,
      goReview,
      goChoose,
      selectAll,
      deselectAll,
      toggleKey,
      actionLabel,
      candidateMeta,
      plan,
      canReview,
      canApply,
      applyLabel,
      apply,
      close,
      editingName,
      termLabel,
    }
  },
}
</script>
