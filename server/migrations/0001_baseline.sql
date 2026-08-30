-- 0001_baseline: the initial major-vis schema (users, sessions, schedules,
-- term parts, and suggested changes). This is the permanent source of truth —
-- every later change to a table ships as its own migration in this directory.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_token ON sessions(token_hash);

CREATE TABLE schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  year TEXT NOT NULL DEFAULT '',
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft',   -- 'draft' | 'official'
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE schedule_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  term TEXT NOT NULL,                    -- 'F' | 'W' | 'S'
  payload TEXT NOT NULL DEFAULT '[]',    -- JSON offerings array
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE(schedule_id, term)
);

CREATE TABLE schedule_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  term TEXT NOT NULL,                       -- 'F' | 'W' | 'S'
  proposer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_version INTEGER NOT NULL,            -- informational: what the proposer saw (never enforced)
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per change of a suggestion. Ops are first-class: each change is
-- its own record with its own status lifecycle ('pending' default), so the
-- owner resolves changes individually and the parent suggestion's status is
-- always derived from these rows. The op column stays a pure diff op (never
-- carries resolution state); the position column preserves proposal order.
CREATE TABLE suggestion_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_id INTEGER NOT NULL REFERENCES schedule_changes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  op TEXT NOT NULL,                         -- JSON diff op (pure payload)
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'accepted' | 'rejected' | 'withdrawn'
  applied INTEGER NOT NULL DEFAULT 0,       -- accepted op actually changed the term
  resolved_at TEXT,
  UNIQUE(suggestion_id, position)
);
CREATE INDEX idx_suggestion_ops_suggestion ON suggestion_ops(suggestion_id);