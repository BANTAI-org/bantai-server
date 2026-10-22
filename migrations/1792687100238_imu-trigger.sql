-- 016
-- Up Migration
ALTER TYPE trigger_source_enum ADD VALUE IF NOT EXISTS 'CRASH_IMU';

-- Down Migration
-- (Enums cannot be dropped easily, so we leave a comment or recreate the type)