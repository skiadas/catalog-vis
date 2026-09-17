// Username helpers shared by the server's identity flows. Usernames are
// canonical: trimmed, lowercased, and (when `domain` is configured) given a
// default domain when none was typed — so "CSkiadas", "cskiadas@hanover.edu",
// and "cskiadas" all refer to the same account. Display helpers strip the
// domain back off for humans.
//
// Phase 1 (access control) calls these without a domain: canonicalization is
// trim + lowercase, matching how the auth providers store usernames (OIDC
// lowercases the email claim; the username provider trims).

/**
 * @param {unknown} raw
 * @param {string} [domain]  optional default domain (e.g. 'hanover.edu')
 * @returns {string}  the canonical username, or '' when `raw` isn't usable
 */
export function canonicalUsername(raw, domain = '') {
  const name = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
  if (!name || name.length > 120) return ''
  if (domain && !name.includes('@')) return `${name}@${domain}`
  return name
}

/**
 * @param {string | null | undefined} username
 * @returns {string}  the username without its domain suffix, for display
 */
export function shortUsername(username) {
  const s = String(username ?? '')
  const at = s.indexOf('@')
  return at > 0 ? s.slice(0, at) : s
}
