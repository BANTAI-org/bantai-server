-- 018
-- Up Migration
--
-- REPAIR MIGRATION
--
-- The `pgmigrations` table records that migration 006 (1791143886097_shift-timer-responder)
-- was applied on 2026-10-05, but the `r_profile.shift_ends_at` column is
-- missing in production. This is schema drift caused by an external event
-- (manual DROP, backup restore, or partial rollback). This migration
-- idempotently re-applies what migration 006 should have done.
--
-- This is safe to run multiple times. It does nothing on databases where
-- the column already exists.

ALTER TABLE r_profile
  ADD COLUMN IF NOT EXISTS shift_ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_r_profile_shift_end
  ON r_profile (shift_ends_at)
  WHERE shift_ends_at IS NOT NULL AND availability = 'on_duty';


-- Down Migration

DROP INDEX IF EXISTS idx_r_profile_shift_end;
ALTER TABLE r_profile DROP COLUMN IF EXISTS shift_ends_at;