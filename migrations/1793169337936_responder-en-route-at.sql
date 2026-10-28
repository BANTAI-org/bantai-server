-- 1792769580440 | 019
-- Up Migration
--
-- Adds incident_responder_assignment.en_route_at, stamped the first time
-- an assignment transitions to EN_ROUTE.
--
-- Why the assignment table and not the incident:
--   * EN_ROUTE is a per-assignment state. The incident follows via
--     sync_incident_from_assignment.
--   * incident_lifecycle_guard is untouched — this is a self-contained
--     addition.
--   * A responder who stood down and was replaced keeps their own
--     en_route_at. Per-assignment history stays accurate.
--
-- No backfill. Existing assignments that are currently EN_ROUTE will get
-- en_route_at on their next status change, or stay NULL. The timeline
-- renders only non-null en_route_at.

ALTER TABLE incident_responder_assignment
  ADD COLUMN en_route_at TIMESTAMPTZ;

COMMENT ON COLUMN incident_responder_assignment.en_route_at IS
  'Stamped once, the first time the assignment transitions to EN_ROUTE. NULL if the assignment never reached EN_ROUTE.';

CREATE OR REPLACE FUNCTION stamp_assignment_en_route_time()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'EN_ROUTE' AND NEW.en_route_at IS NULL THEN
    NEW.en_route_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stamp_assignment_en_route_time
BEFORE INSERT OR UPDATE ON incident_responder_assignment
FOR EACH ROW
EXECUTE FUNCTION stamp_assignment_en_route_time();


-- Down Migration

DROP TRIGGER IF EXISTS trg_stamp_assignment_en_route_time
  ON incident_responder_assignment;
DROP FUNCTION IF EXISTS stamp_assignment_en_route_time();
ALTER TABLE incident_responder_assignment
  DROP COLUMN IF EXISTS en_route_at;