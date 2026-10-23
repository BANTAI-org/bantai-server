-- 016_fix_comms_channel_trigger.sql
-- Up Migration

CREATE OR REPLACE FUNCTION close_comm_channel_on_incident_resolve()
RETURNS TRIGGER AS $$
BEGIN
    -- Close the channel if the incident is resolved OR cancelled
    IF NEW.status IN ('RESOLVED', 'CANCELLED') 
       AND OLD.status NOT IN ('RESOLVED', 'CANCELLED') THEN
        UPDATE comm_channel 
        SET status = 'archived', closed_at = now() 
        WHERE incident_id = NEW.id AND status = 'active';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Down Migration
-- (Revert to the previous definition)