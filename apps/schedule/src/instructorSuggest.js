// Instructor suggestion pools shared by the course editor's combobox and the
// table view's inline instructor cell. Directory people for the department come
// first, then the catalog's faculty roster for the prefix, then instructors
// already on the term — deduped by stored value and sorted by display label.
// `all` is the same across every prefix (the "Show all instructors" escape).

import { compareInstructors, instructorsOf } from '@major-vis/schedule-core'
import { directoryPeople, instructorLabel, matchesDirectory } from './names.js'

function poolEntries(catalogNames, storedValues, dirPeople, directoryIndex) {
  const out = []
  const seen = new Set()
  const add = (label, value) => {
    const key = String(value || '').toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push({ label, value })
  }
  for (const p of dirPeople) add(p.label, p.value)
  for (const name of catalogNames) {
    if (matchesDirectory(name, directoryIndex)) continue
    add(name, name)
  }
  for (const value of storedValues) add(instructorLabel(value, directoryIndex), value)
  return out.sort((a, b) => compareInstructors(a.label, b.label))
}

// Build both pools for one department prefix. `facultyByPrefix` is the catalog
// faculty roster map (`buildFacultyAndEligible(...).facultyByPrefix`),
// `termOfferings` the offerings to mine for already-used instructors, and
// `directoryIndex` the name index (see `src/names.js`).
export function buildInstructorOptions({ prefix, facultyByPrefix, termOfferings, directoryIndex }) {
  const faculty = facultyByPrefix || {}
  const allCatalogFaculty = [...new Set(Object.values(faculty).flat())].sort(compareInstructors)
  const deptValues = new Set()
  const allValues = new Set()
  for (const x of termOfferings || []) {
    for (const name of instructorsOf(x)) {
      allValues.add(name)
      if (x.prefix === prefix) deptValues.add(name)
    }
  }
  return {
    deptOptions: poolEntries(
      faculty[prefix] || [],
      deptValues,
      directoryPeople(directoryIndex, prefix),
      directoryIndex,
    ),
    allOptions: poolEntries(allCatalogFaculty, allValues, directoryPeople(directoryIndex), directoryIndex),
  }
}
