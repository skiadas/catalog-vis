// Cross-listing validation for an imported CSV: compares each row's
// `cross_listed` claim against the catalog's cross-list groups and against the
// sibling rows actually present in the file, and checks that the rows of one
// group agree on their shared scheduling fields.
//
// Pure and catalog-free: the caller passes the catalog's groups (from
// `cross_listings.json`). Only rows that actually carry a `cross_listed` cell
// are compared (a file without the column never flags), matching the export's
// "materialized versions only" column.

/** The fields a cross-listed group's versions must share. Title is excluded —
 *  genuinely cross-listed courses can have different catalog titles. */
const SHARED_FIELDS = ['days', 'time', 'instructor', 'seats']

const codeOf = (r) => `${(r && r.prefix) || ''} ${(r && r.number) || ''}`.trim()
const prefixOf = (code) => String(code).split(' ')[0]

/**
 * @param {Array<{ prefix?: string; number?: string; section?: string; lab?: boolean; days?: string; time?: string; instructor?: string; seats?: number; secondaryInstructors?: string[]; crossListed?: string[] }>} rows
 * @param {Array<{ id: string; codes: string[] }>} groups
 * @returns {{
 *   claims: Array<{ code: string; section: string; claimed: string[]; present: string[]; missing: string[]; extra: string[] }>;
 *   inconsistent: Array<{ codes: string[]; section: string }>;
 * }}
 */
export function crossListIssues(rows, groups) {
  const list = rows || []
  const byCode = new Map()
  for (const g of groups || []) {
    for (const c of g.codes || []) byCode.set(c, g)
  }

  const claims = []
  for (const r of list) {
    const claimed = r.crossListed || []
    if (!claimed.length) continue
    const group = byCode.get(codeOf(r))
    const others = group ? group.codes.filter((c) => c !== codeOf(r)) : []
    const otherPrefixes = new Set(others.map(prefixOf))
    const present = others
      .filter((c) => list.some((x) => !x.lab && codeOf(x) === c && x.section === r.section))
      .map(prefixOf)
    const extra = claimed.filter((p) => !otherPrefixes.has(p))
    const missing = present.filter((p) => !claimed.includes(p))
    if (extra.length || missing.length) {
      claims.push({
        code: codeOf(r),
        section: r.section || '',
        claimed: [...claimed],
        present,
        missing,
        extra,
      })
    }
  }

  const inconsistent = []
  const seen = new Set()
  for (const r of list) {
    const group = byCode.get(codeOf(r))
    if (!group) continue
    const section = r.section || ''
    const key = `${group.id}|${section}`
    if (seen.has(key)) continue
    seen.add(key)
    const members = list.filter(
      (x) => !x.lab && x.section === section && (group.codes || []).includes(codeOf(x)),
    )
    if (members.length < 2) continue
    const signature = (m) =>
      SHARED_FIELDS.map((f) => `${f}=${m[f] == null ? '' : m[f]}`).join('|') +
      `|secondary=${(m.secondaryInstructors || []).join(',')}`
    const first = signature(members[0])
    if (members.some((m) => signature(m) !== first)) {
      inconsistent.push({ codes: members.map(codeOf), section })
    }
  }

  return { claims, inconsistent }
}
