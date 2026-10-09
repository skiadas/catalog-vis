// Instructor-combobox scope helpers, shared by the course editor and the table
// view's inline instructor cell. The suggestion pool is normally the course's
// department roster, but two cases must not leave it empty:
//
//   - a prefix with no department roster (no catalog faculty, no same-prefix
//     term rows, no directory people) falls back to the all-instructors pool,
//     so focusing a brand-new course still offers names;
//   - an offering whose stored instructor is outside its department opens on
//     the all-instructors pool, so that name stays visible.
//
// `instructorPoolFor` is the runtime choice; `defaultShowAll` is the initial
// scope flag. Keeping them pure makes the behavior testable without the DOM.

/**
 * @typedef {{ value: string, label: string }} InstructorOption
 */

/**
 * The suggestion pool for one combobox: the department roster unless the user
 * chose "show all", or the department pool is empty (fall back to every name).
 * @param {{ deptOptions?: InstructorOption[], allOptions?: InstructorOption[], showAll?: boolean }} args
 * @returns {InstructorOption[]}
 */
export function instructorPoolFor({ deptOptions, allOptions, showAll }) {
  const dept = deptOptions || []
  if (showAll || !dept.length) return allOptions || []
  return dept
}

/**
 * Whether a combobox should open on the all-instructors pool: true when the
 * offering already names someone who isn't in its department pool (an outside
 * instructor must stay visible). Blank instructors default to the department.
 * @param {string} instructor the offering's stored instructor value
 * @param {InstructorOption[]} deptOptions
 * @returns {boolean}
 */
export function defaultShowAll(instructor, deptOptions) {
  if (!instructor) return false
  return !(deptOptions || []).some((e) => e.value === instructor)
}
