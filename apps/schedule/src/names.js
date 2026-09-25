// Name helpers for the schedule app. Two distinct jobs live here:
//
// 1. Username shortening (`displayName`) — identity stays canonical (a full
//    lowercase address, e.g. "cskiadas@hanover.edu"); humans see the short form.
// 2. Directory resolution (`buildNameIndex` + `instructorLabel` /
//    `canonicalInstructor`) — an instructor value stored on an offering is the
//    canonical identity, while the user directory maps it to a full name. The
//    app displays the full name and, when someone picks one, stores the short
//    username again, so the CSV round-trip and filter keys stay stable.

/**
 * @param {string | null | undefined} username
 * @returns {string}  the username without its domain suffix, for display
 */
export function displayName(username) {
  const s = String(username ?? '')
  const at = s.indexOf('@')
  return at > 0 ? s.slice(0, at) : s
}

// A lookup key for usernames: trimmed, lowercased, whitespace removed (so
// "CSkiadas", "cskiadas", and "cskiadas @ hanover.edu" fold together).
export function usernameKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

// A lookup key for display names: trimmed, lowercased, internal whitespace
// collapsed (a display name is prose, not an identifier).
export function nameKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

// Name tokens for overlap tests: alphanumeric runs of two or more characters,
// lowercased (so a catalog surname "Skiadas" matches directory "Haris Skiadas").
function nameTokens(value) {
  return nameKey(value)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
}

/**
 * A single directory person, in index form.
 * @typedef {{ username: string, displayName: string, departments: string[], value: string }} DirectoryPerson
 */

/**
 * Build the directory name index from a roster (`[{ username, displayName,
 * departments }]`, as `/api/users/roster` or the admin list returns). Two maps
 * drive resolution:
 *
 * - `byUser`: any username spelling (full address and its domain-stripped short
 *   form) -> the full display name. A real name always wins over a null one, so
 *   a stale bare account can't shadow its canonical `name@domain` row.
 * - `canonicalUser`: any username spelling -> the account's short username, the
 *   form a picked instructor is stored as.
 * - `byName`: a display name -> the short username, so picking a full name
 *   stores the canonical identity.
 *
 * `people` lists the named accounts (with their departments) for the editor's
 * picker, and `tokens` collects their name tokens for de-duplicating the
 * catalog's surname-only faculty list against them.
 *
 * @param {Array<{ username?: string, displayName?: string | null, departments?: string[] }>} [roster]
 */
export function buildNameIndex(roster) {
  const byUser = new Map()
  const canonicalUser = new Map()
  const byName = new Map()
  const people = []
  const tokens = new Set()
  const setBest = (map, key, value) => {
    if (!key) return
    if (!map.has(key) || map.get(key) == null) map.set(key, value)
  }
  for (const entry of roster || []) {
    const username = String((entry && entry.username) || '').trim()
    if (!username) continue
    const label = String((entry && entry.displayName) || '').trim()
    const short = displayName(username)
    setBest(byUser, usernameKey(username), label || null)
    setBest(byUser, usernameKey(short), label || null)
    setBest(canonicalUser, usernameKey(username), short)
    setBest(canonicalUser, usernameKey(short), short)
    if (!label) continue
    setBest(byName, nameKey(label), short)
    if (!people.some((p) => p.value === short)) {
      people.push({
        username,
        displayName: label,
        departments: (entry.departments || []).map((d) => String(d).toUpperCase()),
        value: short,
      })
    }
    for (const token of nameTokens(label)) tokens.add(token)
    for (const token of nameTokens(short)) tokens.add(token)
  }
  return { byUser, canonicalUser, byName, people, tokens }
}

// An empty index: labels resolve to themselves, canonicals to raw text. Used
// offline and before the roster loads, so every caller can skip null checks.
const EMPTY_INDEX = buildNameIndex([])

/**
 * The display label for a stored instructor value: the directory's full name
 * when it maps to an account, else the value itself (free text, new hires, or
 * an offline session).
 * @param {string | null | undefined} value
 * @param {ReturnType<typeof buildNameIndex>} [index]
 */
export function instructorLabel(value, index) {
  const s = String(value ?? '').trim()
  if (!s) return ''
  const label = (index || EMPTY_INDEX).byUser.get(usernameKey(s))
  return label || s
}

/**
 * The value to store for an instructor the user typed or picked: the account's
 * short username when the text names a directory person, else the text as
 * typed. This keeps a picked full name ("Haris Skiadas") stored as its identity
 * ("skiadas") while preserving free-text entries verbatim.
 * @param {string | null | undefined} value
 * @param {ReturnType<typeof buildNameIndex>} [index]
 */
export function canonicalInstructor(value, index) {
  const s = String(value ?? '').trim()
  if (!s) return ''
  const dir = index || EMPTY_INDEX
  const byName = dir.byName.get(nameKey(s))
  if (byName) return byName
  const canonical = dir.canonicalUser.get(usernameKey(s))
  if (canonical) return canonical
  return s
}

/**
 * Whether a surname-only catalog name overlaps a directory person (a shared
 * token), so the editor can show the directory's full name instead of both.
 * @param {string} name
 * @param {ReturnType<typeof buildNameIndex>} [index]
 */
export function matchesDirectory(name, index) {
  const tokens = (index || EMPTY_INDEX).tokens
  return nameTokens(name).some((t) => tokens.has(t))
}

/**
 * The directory people in a department (course prefix), as picker entries
 * (`{ label, value }`); all people when `prefix` is empty.
 * @param {ReturnType<typeof buildNameIndex>} [index]
 * @param {string} [prefix]
 */
export function directoryPeople(index, prefix = '') {
  const people = (index || EMPTY_INDEX).people
  const wanted = String(prefix || '').toUpperCase()
  return people
    .filter((p) => !wanted || p.departments.includes(wanted))
    .map((p) => ({ label: p.displayName, value: p.value }))
}
