-- 1792216200000 | 014
-- Up Migration
-- Add actor_name to system_audit_log and update the three functions that insert into it.
--
-- No DROP FUNCTION here on purpose: audit_report_submission() and
-- notify_and_audit_report_review() are trigger functions, and Postgres refuses
-- to drop a function a trigger depends on. CREATE OR REPLACE is enough because
-- the signatures and return types are unchanged.

ALTER TABLE system_audit_log ADD COLUMN IF NOT EXISTS actor_name TEXT;

-- Update audit_incident_event function
CREATE OR REPLACE FUNCTION audit_incident_event(
    p_actor_id UUID,
    p_command_center_id UUID,
    p_action audit_action,
    p_incident_id UUID,
    p_old_payload JSONB,
    p_new_payload JSONB
) RETURNS VOID AS $$
DECLARE
    v_actor_name TEXT;
BEGIN
    IF p_actor_id IS NOT NULL THEN
        SELECT f_name || ' ' || l_name
        INTO v_actor_name
        FROM user_account
        WHERE id = p_actor_id;
    END IF;

    INSERT INTO system_audit_log
        (actor_id, command_center_id, action, target_entity, target_id, old_payload, new_payload, actor_name)
    VALUES
        (p_actor_id, p_command_center_id, p_action, 'incident', p_incident_id, p_old_payload, p_new_payload, v_actor_name);
END;
$$ LANGUAGE plpgsql;

-- Update audit_report_submission function
CREATE OR REPLACE FUNCTION audit_report_submission()
RETURNS TRIGGER AS $$
DECLARE
    v_is_new_submission BOOLEAN;
    v_actor_name TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_is_new_submission := (NEW.status = 'submitted');
    ELSE
        v_is_new_submission := (NEW.status = 'submitted' AND OLD.status IS DISTINCT FROM 'submitted');
    END IF;

    IF v_is_new_submission THEN
        IF NEW.submitted_by_id IS NOT NULL THEN
            SELECT f_name || ' ' || l_name
            INTO v_actor_name
            FROM user_account
            WHERE id = NEW.submitted_by_id;
        END IF;

        INSERT INTO system_audit_log (actor_id, command_center_id, action, target_entity, target_id, new_payload, actor_name)
        VALUES (
            NEW.submitted_by_id,
            NEW.command_center_id,
            'SUBMIT_INCIDENT_REPORT',
            'incident_report',
            NEW.id,
            jsonb_build_object('incident_id', NEW.incident_id, 'disposition', NEW.disposition),
            v_actor_name
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update notify_and_audit_report_review function
CREATE OR REPLACE FUNCTION notify_and_audit_report_review()
RETURNS TRIGGER AS $$
DECLARE
    v_actor_name TEXT;
BEGIN
    IF NEW.status IN ('needs_revision', 'approved') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
        INSERT INTO notification (user_id, type, tone, title, body, related_entity, related_entity_id)
        VALUES (
            COALESCE(NEW.submitted_by_id, NEW.assigned_reporter_id),
            'report_review_result',
            -- Explicit cast: a CASE over bare literals resolves to text,
            -- which Postgres will not implicitly cast into an enum column.
            CASE WHEN NEW.status = 'approved'
                THEN 'success'::notification_tone_enum
                ELSE 'attention'::notification_tone_enum
            END,
            CASE WHEN NEW.status = 'approved' THEN 'Report approved' ELSE 'Report needs revision' END,
            COALESCE(
                NEW.reviewer_notes,
                CASE WHEN NEW.status = 'approved'
                    THEN 'Your incident report has been reviewed and approved.'
                    ELSE 'Your incident report was sent back for revision.'
                END
            ),
            'incident_report',
            NEW.id
        );

        IF NEW.reviewed_by IS NOT NULL THEN
            SELECT f_name || ' ' || l_name
            INTO v_actor_name
            FROM user_account
            WHERE id = NEW.reviewed_by;
        END IF;

        INSERT INTO system_audit_log (actor_id, command_center_id, action, target_entity, target_id, old_payload, new_payload, actor_name)
        VALUES (
            NEW.reviewed_by,
            NEW.command_center_id,
            'REVIEW_INCIDENT_REPORT',
            'incident_report',
            NEW.id,
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status, 'reviewer_notes', NEW.reviewer_notes),
            v_actor_name
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- Down Migration
-- Revert the three functions to their pre-014 bodies, then drop the column.

CREATE OR REPLACE FUNCTION audit_incident_event(
    p_actor_id UUID,
    p_command_center_id UUID,
    p_action audit_action,
    p_incident_id UUID,
    p_old_payload JSONB,
    p_new_payload JSONB
) RETURNS VOID AS $$
BEGIN
    INSERT INTO system_audit_log
        (actor_id, command_center_id, action, target_entity, target_id, old_payload, new_payload)
    VALUES
        (p_actor_id, p_command_center_id, p_action, 'incident', p_incident_id, p_old_payload, p_new_payload);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_report_submission()
RETURNS TRIGGER AS $$
DECLARE
    v_is_new_submission BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_is_new_submission := (NEW.status = 'submitted');
    ELSE
        v_is_new_submission := (NEW.status = 'submitted' AND OLD.status IS DISTINCT FROM 'submitted');
    END IF;

    IF v_is_new_submission THEN
        INSERT INTO system_audit_log (actor_id, command_center_id, action, target_entity, target_id, new_payload)
        VALUES (
            NEW.submitted_by_id,
            NEW.command_center_id,
            'SUBMIT_INCIDENT_REPORT',
            'incident_report',
            NEW.id,
            jsonb_build_object('incident_id', NEW.incident_id, 'disposition', NEW.disposition)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_and_audit_report_review()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('needs_revision', 'approved') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
        INSERT INTO notification (user_id, type, tone, title, body, related_entity, related_entity_id)
        VALUES (
            COALESCE(NEW.submitted_by_id, NEW.assigned_reporter_id),
            'report_review_result',
            CASE WHEN NEW.status = 'approved'
                THEN 'success'::notification_tone_enum
                ELSE 'attention'::notification_tone_enum
            END,
            CASE WHEN NEW.status = 'approved' THEN 'Report approved' ELSE 'Report needs revision' END,
            COALESCE(
                NEW.reviewer_notes,
                CASE WHEN NEW.status = 'approved'
                    THEN 'Your incident report has been reviewed and approved.'
                    ELSE 'Your incident report was sent back for revision.'
                END
            ),
            'incident_report',
            NEW.id
        );

        INSERT INTO system_audit_log (actor_id, command_center_id, action, target_entity, target_id, old_payload, new_payload)
        VALUES (
            NEW.reviewed_by,
            NEW.command_center_id,
            'REVIEW_INCIDENT_REPORT',
            'incident_report',
            NEW.id,
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status, 'reviewer_notes', NEW.reviewer_notes)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE system_audit_log DROP COLUMN IF EXISTS actor_name;