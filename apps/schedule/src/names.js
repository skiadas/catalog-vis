// Username display helpers for the schedule app. Identity stays canonical
// (full lowercase address, e.g. "cskiadas@hanover.edu" under OIDC); humans see
// the short form ("cskiadas") everywhere a username surfaces. The server owns
// canonicalization — this module only strips for display.

/**
 * @param {string | null | undefined} username
 * @returns {string}  the username without its domain suffix, for display
 */
export function displayName(username) {
  const s = String(username ?? '')
  const at = s.indexOf('@')
  return at > 0 ? s.slice(0, at) : s
}
