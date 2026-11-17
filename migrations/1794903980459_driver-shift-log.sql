-- 020
-- Up Migration
CREATE TABLE IF NOT EXISTS driver_shift_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    distance_meters NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_shift_log_driver_started UNIQUE (driver_id, started_at),
    CONSTRAINT chck_shift_duration_positive CHECK (ended_at >= started_at),
    CONSTRAINT chck_shift_distance_nonneg CHECK (distance_meters >= 0)
);

CREATE INDEX idx_driver_shift_log_recent
    ON driver_shift_log (driver_id, ended_at DESC);

-- Down Migration
DROP TABLE IF EXISTS driver_shift_log;