// Core-requirement import validation: compares the `core_reqs` column of an
// imported CSV against the catalog's own area lists for each course, so a stale
// or hand-edited sheet is flagged in the import summary before it becomes a
// schedule. Nothing is stored from the column — the catalog stays the source of
// truth for what a course satisfies.
//
// The comparison only looks at rows whose `core_reqs` cell actually carries
// values ("if the sheet has these requirements present"): a blank cell — or a
// file without the column, which parses to all-empty rows — never flags. Both
// directions count as a disagreement: an area the file omits and one the file
// adds.
//
// Pure and catalog-free (like schedule-core): the caller passes the catalog's
// code -> area-ids map. A code absent from that map is a course with no core
// areas (the map only carries codes that satisfy something), so a file claiming
// an area for it still flags. `knownCodes` (the catalog's full course-code set)
// separates those from courses the catalog does not carry at all — the latter
// are skipped (their expected set is unknown, not wrong) and reported as
// `unknown` so the UI can say so. Without `knownCodes`, every code is treated as
// known.

/**
 * @typedef {Object} CoreReqsDisagreement
 * @property {string} code         the course code (`CS 220`)
 * @property {string} section      the offering's section label (`A`)
 * @property {string[]} file       the area ids the file claims
 * @property {string[]} catalog    the area ids the catalog lists
 * @property {string[]} missing    catalog areas the file omits
 * @property {string[]} extra      file areas the catalog does not list
 */

/**
 * @param {Array<{ prefix?: string; number?: string; section?: string; coreReqs?: string[] }>} rows
 * @param {Map<string, string[]>} reqsByCode
 * @param {Set<string>} [knownCodes]
 * @returns {{ disagreements: CoreReqsDisagreement[]; unknown: number }}
 */
export function coreReqsDisagreements(rows, reqsByCode, knownCodes) {
  const disagreements = []
  let unknown = 0
  const map = reqsByCode || new Map()
  for (const row of rows || []) {
    const file = row.coreReqs || []
    if (!file.length) continue
    const code = `${row.prefix || ''} ${row.number || ''}`.trim()
    if (knownCodes && !knownCodes.has(code)) {
      unknown++
      continue
    }
    const catalog = map.get(code) || []
    const missing = catalog.filter((r) => !file.includes(r))
    const extra = file.filter((r) => !catalog.includes(r))
    if (!missing.length && !extra.length) continue
    disagreements.push({
      code,
      section: row.section || '',
      file: [...file],
      catalog: [...catalog],
      missing,
      extra,
    })
  }
  return { disagreements, unknown }
}
