-- 0004_directory: the admin-maintained user directory. `display_name` is the
-- real/catalog name shown instead of the bare username; `departments` is a
-- JSON array of course prefixes (e.g. ["CS", "MAT"]) used to scope who may
-- suggest changes for which departments. Both are admin-managed; users are
-- still JIT-provisioned at first sign-in, and an admin can pre-create a row
-- (username) before the person ever signs in.

ALTER TABLE users ADD COLUMN display_name TEXT;                  -- NULL = show the username
ALTER TABLE users ADD COLUMN departments TEXT NOT NULL DEFAULT '[]';  -- JSON prefix array