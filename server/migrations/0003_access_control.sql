-- 0003_access_control: per-schedule visibility and suggestion permissions.
-- Every schedule starts (and existing rows read) 'private'/'owner' — nothing is
-- shared until its owner opens it up. `viewers`/`suggesters` are JSON arrays of
-- canonical usernames used when the corresponding mode is 'shared'; a listed
-- suggester can always view too (you must see a schedule to propose against it).

ALTER TABLE schedules ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';  -- 'private' | 'shared' | 'public'
ALTER TABLE schedules ADD COLUMN suggest_mode TEXT NOT NULL DEFAULT 'owner';  -- 'owner' | 'shared' | 'public'
ALTER TABLE schedules ADD COLUMN viewers TEXT NOT NULL DEFAULT '[]';          -- JSON username array
ALTER TABLE schedules ADD COLUMN suggesters TEXT NOT NULL DEFAULT '[]';       -- JSON username array