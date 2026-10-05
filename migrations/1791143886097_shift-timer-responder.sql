-- Up Migration
-- Responder shift timer: when a responder's on-duty shift ends automatically.
--
-- NULL means "no timer" (off duty, or never set). The app always sets one
-- when a responder goes on duty (12 h default), so an on-duty responder
-- should always have a value. The sweeper (ResponderRepository.expireDueShifts)
-- sets expired responders off duty, wherever they are, and writes the
-- 'shift_auto_ended' notification.
--
-- Deliberately NO check tying this column to availability: the
-- trg_revoke_sessions_on_soft_delete trigger sets availability = 'off_duty'
-- directly and would violate it. The sweeper only looks at rows that are
-- 'on_duty', so a stale value on an off-duty row is harmless; going on duty
-- overwrites it and going off duty clears it.

ALTER TABLE r_profile ADD COLUMN shift_ends_at TIMESTAMPTZ;

COMMENT ON COLUMN r_profile.shift_ends_at IS
    'When the current on-duty shift auto-ends. Set when going on duty, cleared when going off duty or when the sweeper ends the shift. NULL = no timer.';

-- The sweeper runs every 30-60 s and only ever scans on-duty responders
-- that have a timer, so index just those rows.
CREATE INDEX idx_r_profile_shift_end
    ON r_profile (shift_ends_at)
    WHERE shift_ends_at IS NOT NULL AND availability = 'on_duty';


-- Down Migration

DROP INDEX IF EXISTS idx_r_profile_shift_end;
ALTER TABLE r_profile DROP COLUMN IF EXISTS shift_ends_at;