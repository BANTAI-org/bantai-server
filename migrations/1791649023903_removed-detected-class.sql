-- 011
-- Up Migration
-- 011: drop incident.detected_class.
--
-- threat_type (009) is what the system acts on. The raw model label is no
-- longer stored. If you still want to know which labels the model emits that
-- the label map doesn't know yet, log the raw label when classifyDetection()
-- returns OTHER (only an unrecognised label produces OTHER).
--
-- The view incident_logs selects detected_class, so Postgres refuses to drop
-- the column while the view exists. A view can't lose a column through
-- CREATE OR REPLACE either, so the view is dropped and rebuilt below: the same
-- columns as before, except detected_class is gone and its replacement
-- threat_type takes its place, plus severity (added after threat_level).
-- NOTE: this redefines incident_logs in full. If you changed that view in an
-- earlier migration, merge that change into the definition below.
--
-- PRE-FLIGHT: this DROPS the column and its data, and anything else that reads
-- it will fail: search your code for detected_class (inserts and SELECTs).

DROP VIEW incident_logs;

ALTER TABLE incident DROP COLUMN detected_class;

CREATE VIEW incident_logs AS
SELECT
    i.id AS incident_id,
    i.trigger_source,
    i.threat_type,
    i.confidence_level,
    i.threat_category,
    i.threat_level,
    i.severity,
    i.status,
    i.outcome,
    i.driver_id,
    u.f_name || ' ' || u.l_name AS rider_name,
    u.deleted_at AS rider_deleted_at,
    d.hardware_serial,
    i.claimed_by_id,
    cu.f_name || ' ' || cu.l_name AS claimed_by_name,
    crp.agency AS claimed_by_agency,
    esc.command_center_id AS escalated_command_center_id,
    esc.reason AS escalation_reason,
    rep.disposition,
    rep.status AS report_status,
    i.created_at AS detected_at,
    i.dispatched_at,
    i.claimed_at,
    i.on_scene_at,
    i.escalated_at,
    i.verified_at,
    i.resolved_at,
    i.cancelled_at,
    EXTRACT(EPOCH FROM (i.claimed_at - i.created_at)) AS time_to_claim_seconds,
    EXTRACT(EPOCH FROM (i.on_scene_at - i.created_at)) AS time_to_scene_seconds,
    EXTRACT(EPOCH FROM (i.resolved_at - i.created_at)) AS time_to_resolution_seconds
FROM incident i
LEFT JOIN user_account u ON u.id = i.driver_id
LEFT JOIN device d ON d.id = i.device_id
LEFT JOIN user_account cu ON cu.id = i.claimed_by_id
LEFT JOIN r_profile crp ON crp.user_id = i.claimed_by_id
LEFT JOIN LATERAL (
    SELECT e.command_center_id, e.reason
    FROM incident_escalation e
    WHERE e.incident_id = i.id
    ORDER BY e.escalated_at DESC
    LIMIT 1
) esc ON true
LEFT JOIN LATERAL (
    SELECT r.disposition, r.status
    FROM incident_report r
    WHERE r.incident_id = i.id
    ORDER BY r.created_at DESC
    LIMIT 1
) rep ON true;


-- Down Migration
-- Restores the column and the previous view. The raw labels that were stored
-- are not recoverable: every row comes back with detected_class NULL.
DROP VIEW IF EXISTS incident_logs;

ALTER TABLE incident ADD COLUMN detected_class VARCHAR(50);

CREATE VIEW incident_logs AS
SELECT
    i.id AS incident_id,
    i.trigger_source,
    i.detected_class,
    i.confidence_level,
    i.threat_category,
    i.threat_level,
    i.status,
    i.outcome,
    i.driver_id,
    u.f_name || ' ' || u.l_name AS rider_name,
    u.deleted_at AS rider_deleted_at,
    d.hardware_serial,
    i.claimed_by_id,
    cu.f_name || ' ' || cu.l_name AS claimed_by_name,
    crp.agency AS claimed_by_agency,
    esc.command_center_id AS escalated_command_center_id,
    esc.reason AS escalation_reason,
    rep.disposition,
    rep.status AS report_status,
    i.created_at AS detected_at,
    i.dispatched_at,
    i.claimed_at,
    i.on_scene_at,
    i.escalated_at,
    i.verified_at,
    i.resolved_at,
    i.cancelled_at,
    EXTRACT(EPOCH FROM (i.claimed_at - i.created_at)) AS time_to_claim_seconds,
    EXTRACT(EPOCH FROM (i.on_scene_at - i.created_at)) AS time_to_scene_seconds,
    EXTRACT(EPOCH FROM (i.resolved_at - i.created_at)) AS time_to_resolution_seconds
FROM incident i
LEFT JOIN user_account u ON u.id = i.driver_id
LEFT JOIN device d ON d.id = i.device_id
LEFT JOIN user_account cu ON cu.id = i.claimed_by_id
LEFT JOIN r_profile crp ON crp.user_id = i.claimed_by_id
LEFT JOIN LATERAL (
    SELECT e.command_center_id, e.reason
    FROM incident_escalation e
    WHERE e.incident_id = i.id
    ORDER BY e.escalated_at DESC
    LIMIT 1
) esc ON true
LEFT JOIN LATERAL (
    SELECT r.disposition, r.status
    FROM incident_report r
    WHERE r.incident_id = i.id
    ORDER BY r.created_at DESC
    LIMIT 1
) rep ON true;