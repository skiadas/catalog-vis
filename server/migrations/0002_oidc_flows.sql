-- 0002_oidc_flows: short-lived state for in-flight OIDC logins (state, nonce,
-- PKCE verifier, and the app path to return to). Rows are single-use — the
-- callback deletes the row it consumes — and expired rows are pruned lazily on
-- the next login. Nothing here is user data; it is the CSRF/PKCE handshake for
-- one browser's login redirect.

CREATE TABLE oidc_flows (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
