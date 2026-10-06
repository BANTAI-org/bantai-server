-- 007
-- Up Migration
CREATE TYPE driver_duty AS ENUM ('on_duty', 'off_duty');

ALTER TABLE "d_profile"
  ADD COLUMN duty_status driver_duty NOT NULL DEFAULT 'off_duty',
  ADD COLUMN shift_ends_at TIMESTAMPTZ;

-- Shift-expiry sweeper: runs every 30-60 s and only ever looks at on-duty
-- drivers that have a timer, so index just those rows. Stays tiny however
-- many drivers are registered.
CREATE INDEX idx_d_profile_shift_end
  ON "d_profile" (shift_ends_at)
  WHERE duty_status = 'on_duty' AND shift_ends_at IS NOT NULL;

-- "Who is on duty right now?" (dashboards, counts, filtering a nearby-driver
-- list). Covers only on-duty rows, so Postgres finds them without scanning
-- the whole table, and the index stays tiny (it answers count/list queries
-- index-only once autovacuum has run).
CREATE INDEX idx_d_profile_on_duty
  ON "d_profile" (user_id)
  WHERE duty_status = 'on_duty';

-- Deliberately NO plain index on duty_status: it has two values, so the
-- planner would ignore it, and every duty toggle would pay to maintain it.


-- Down Migration
DROP INDEX IF EXISTS idx_d_profile_on_duty;
DROP INDEX IF EXISTS idx_d_profile_shift_end;

ALTER TABLE "d_profile"
  DROP COLUMN IF EXISTS duty_status,
  DROP COLUMN IF EXISTS shift_ends_at;

DROP TYPE IF EXISTS driver_duty;