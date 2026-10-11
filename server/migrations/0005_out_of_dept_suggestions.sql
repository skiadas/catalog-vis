-- 0005_out_of_dept_suggestions: a per-schedule switch that drops the department
-- scope on non-owner suggestions. By default a proposer may only touch courses
-- in their own directory departments (the `dept_restricted` rule); with this on,
-- any suggester the schedule admits may propose changes to any course. It does
-- not change *who* may suggest (owner / listed / public still applies) or who
-- approves (the owner resolves every operation).

ALTER TABLE schedules ADD COLUMN allow_out_of_dept INTEGER NOT NULL DEFAULT 0;
