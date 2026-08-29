// Shared browser catalog data layer.
//
// Loads the three catalog artifacts (majors.json, requirements_parsed.json,
// core_requirements.json) into Vue-reactive refs and derives browse filters.
// This is the read-only data contract all apps consume; the college catalog
// API plugs in here via `loadCatalog`'s `baseUrl`.
//
// Fetched documents are validated against the catalog contract before they
// are stored (`validate: true` by default, see `loadCatalog`): a source that
// serves data the app can't render fails loudly on screen instead of silently
// showing an empty catalog.
//
// The refs and lenses are JSDoc-typed against `@major-vis/catalog-contract`'s
// declarations, so every app that imports this package type-checks against
// the real catalog shape.

import { ref, computed } from 'vue'
import { validateCatalog } from '@major-vis/catalog-contract'

/** @type {import('vue').Ref<import('@major-vis/catalog-contract').Program[]>} */
export const programs = ref([])
/** @type {import('vue').Ref<Record<string, import('@major-vis/catalog-contract').CatalogCourse>>} */
export const allCourses = ref({})
/** @type {import('vue').Ref<Record<string, import('@major-vis/catalog-contract').ProgramRequirement[]>>} */
export const parsedRequirements = ref({})
/** @type {import('vue').Ref<import('@major-vis/catalog-contract').CoreRequirement[]>} */
export const coreRequirements = ref([])
/** @type {import('vue').Ref<boolean>} */
export const loading = ref(true)
/** @type {import('vue').Ref<string>} */
export const searchQuery = ref('')
/** @type {import('vue').Ref<string>} */
export const filterType = ref('all')
// Why the catalog could not be loaded (network failure or contract validation
// failure), or '' after a successful load. The apps render this instead of
// the (empty) catalog UI.
/** @type {import('vue').Ref<string>} */
export const errorMessage = ref('')

// Fetches the catalog artifacts and populates the shared refs. `baseUrl` is
// the seam for pointing an app at a different catalog source (a college-hosted
// API or another host); `files` overrides the per-artifact paths. When
// `validate` is true (default) each document must pass the catalog contract —
// on failure the refs stay empty, `errorMessage` is set, and the promise
// rejects (callers render the message instead of the empty catalog). The
// validator always judges documents under their canonical artifact filenames
// (`majors.json`, ...), regardless of the `files` paths they were fetched from.
/**
 * @typedef {Object} CatalogOptions
 * @property {string} [baseUrl]
 * @property {{ majors?: string; parsed?: string; core?: string }} [files]
 * @property {boolean} [validate]
 */

/**
 * @param {CatalogOptions} [options]
 * @returns {Promise<void>}
 */
export async function loadCatalog({ baseUrl = '', files, validate = true } = {}) {
  const paths = files || {
    majors: 'majors.json',
    parsed: 'requirements_parsed.json',
    core: 'core_requirements.json',
  }
  try {
    const [majorsRes, parsedRes, coreRes] = await Promise.all([
      fetch(baseUrl + paths.majors),
      fetch(baseUrl + paths.parsed),
      fetch(baseUrl + paths.core),
    ])
    const majorsData = /** @type {import('@major-vis/catalog-contract').MajorsDoc} */ (await majorsRes.json())
    const parsedData = /** @type {import('@major-vis/catalog-contract').RequirementsDoc} */ (
      await parsedRes.json()
    )
    const coreData = /** @type {import('@major-vis/catalog-contract').CoreRequirementsDoc} */ (
      await coreRes.json()
    )

    if (validate) {
      const issues = validateCatalog({
        'majors.json': majorsData,
        'requirements_parsed.json': parsedData,
        'core_requirements.json': coreData,
      })
      if (issues) {
        const detail = issues
          .map(
            ({ file, errors }) =>
              `${file}: ${errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`,
          )
          .join(' | ')
        const message = `Catalog data failed contract validation: ${detail}`
        errorMessage.value = message
        console.error(message)
        throw new Error(message)
      }
    }

    programs.value = majorsData.programs
    // The global catalog (every API course, incl. cross-listed and orphan codes
    // that appear in no single program's list) seeds the universe first so the
    // planner can resolve HF/SMGT/cross-listed courses; per-program courses then
    // fill it in richer detail where available.
    /** @type {Record<string, import('@major-vis/catalog-contract').CatalogCourse>} */
    const map = {}
    for (const code in majorsData.catalog || {}) {
      map[code] = majorsData.catalog[code]
    }
    for (const p of majorsData.programs) {
      for (const c of p.courses) {
        map[c.course_code] = c
      }
    }
    allCourses.value = map
    /** @type {Record<string, import('@major-vis/catalog-contract').ProgramRequirement[]>} */
    const parsedMap = {}
    for (const p of parsedData.programs) {
      parsedMap[p.id] = p.requirements
    }
    parsedRequirements.value = parsedMap
    coreRequirements.value = ((coreData.programs || [])[0] || {}).requirements || []
  } catch (err) {
    // Network/parse failures and validation failures land here: the refs stay
    // empty so the apps render `errorMessage` instead of a broken catalog.
    if (!errorMessage.value) {
      errorMessage.value = `Failed to load catalog data: ${err instanceof Error ? err.message : err}`
      console.error(errorMessage.value)
    }
    throw err
  } finally {
    loading.value = false
  }
}

/**
 * Programs whose course list includes `courseCode`. Returns `{ program }`
 * wrappers (the shape CourseDetail expects).
 * @param {string} courseCode
 * @returns {Array<{ program: import('@major-vis/catalog-contract').Program }>}
 */
export function programsUsingCourse(courseCode) {
  return programs.value
    .filter((p) => p.courses.some((c) => c.course_code === courseCode))
    .map((p) => ({ program: p }))
}

// Convenience lookups over `allCourses` — the codebase's one way to fetch a
// course's record or name. Returns null/'' for codes not in the catalog, so
// components don't hand-roll the `allCourses[code] ? allCourses[code].x : ''`
// pattern.
/**
 * @param {string} code
 * @returns {import('@major-vis/catalog-contract').CatalogCourse | null}
 */
export function courseByCode(code) {
  return allCourses.value[code] || null
}

/**
 * @param {string} code
 * @returns {string}
 */
export function courseName(code) {
  const c = allCourses.value[code]
  return c ? c.course_name : ''
}

/** @type {import('vue').ComputedRef<import('@major-vis/catalog-contract').Program[]>} */
export const filteredPrograms = computed(() => {
  let list = programs.value
  if (filterType.value !== 'all') {
    list = list.filter((p) => p.type.includes(filterType.value))
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || (p.course_prefix && p.course_prefix.toLowerCase().includes(q)),
    )
  }
  return list
})

// ---- Planner track identity (derived from catalog data) ------------------
// A program's addable planner units are its "tracks" — one per parsed
// requirement, keyed by a slug of the requirement's label (stable across
// re-scrapes). Shared by the browse app (for planner deep links) and the
// planner store (which re-exports it).

// The core curriculum is modeled as a planner-only "program" — not part of the
// browseable catalog (`programs`) — but appears in the planner's add-track
// picker. It is a single addable track ("General Degree Requirements") whose
// sections are the CCR/ACE areas.
export const CORE_ID = 'core-curriculum'
export const CORE_TRACK = 'core'
export const CORE_LABEL = 'General Degree Requirements'

// Slug for a track's label, used as its stable planner key.
/**
 * @param {string} label
 * @returns {string}
 */
export function trackSlug(label) {
  const slug = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || 'track'
}

// The addable planner tracks for a program (`{ programId, trackKey, label }`).
/**
 * @param {string} programId
 * @returns {Array<{ programId: string; trackKey: string; label: string }>}
 */
export function programTracks(programId) {
  if (programId === CORE_ID) {
    return coreRequirements.value.length
      ? [{ programId: CORE_ID, trackKey: CORE_TRACK, label: CORE_LABEL }]
      : []
  }
  const program = programs.value.find((p) => p.id === programId)
  const parsed = parsedRequirements.value[programId] || []
  if (!program || !parsed.length) return []
  return parsed.map((req) => ({
    programId,
    trackKey: trackSlug(req.label),
    label: req.label,
  }))
}
