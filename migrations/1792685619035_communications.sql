-- 015
-- Up Migration
--
-- Architecture Summary:
-- This schema supports real-time tactical communications (Text Chat + Push-to-Talk Radio).
-- 
-- 1. Text Chat: Messages are persisted in Postgres for history.
-- 2. Radio (WebRTC): The database manages the STATE (who is in the room, who holds 
--    the mic), but NOT the audio. Actual voice data is Peer-to-Peer via WebRTC.
-- 3. Join Policy: Anyone (Peer or Responder) can request to join a channel. 
-- 4. Talk Queue: A strict priority queue prevents users from talking over each other. 
--    Responders (e.g., MDRRMO) are assigned a higher priority than Peer Drivers.

-- ============================================================
-- 1. ENUMS
-- ============================================================
CREATE TYPE comm_channel_status AS ENUM ('active', 'archived');
CREATE TYPE comm_participant_role AS ENUM ('dispatcher', 'responder', 'peer');
CREATE TYPE comm_message_type AS ENUM ('text', 'system_alert', 'location_share');
CREATE TYPE comm_radio_status AS ENUM ('requested', 'speaking', 'completed', 'declined');

-- ============================================================
-- 2. TABLES
-- ============================================================

-- Channels are usually tied to an incident, but can be general dispatch channels.
CREATE TABLE IF NOT EXISTS comm_channel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID REFERENCES incident(id) ON DELETE CASCADE,
    
    name VARCHAR(100) NOT NULL, -- e.g., "C5 Incident - Tactical"
    status comm_channel_status NOT NULL DEFAULT 'active',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    
    CONSTRAINT chck_channel_name_not_empty CHECK (trim(name) <> '')
);

-- Who is currently in the channel. 
-- Joining is as simple as inserting a row here.
CREATE TABLE IF NOT EXISTS comm_participant (
    channel_id UUID NOT NULL REFERENCES comm_channel(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    
    role comm_participant_role NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at TIMESTAMPTZ,
    
    PRIMARY KEY (channel_id, user_id)
);

-- Text chat messages.
CREATE TABLE IF NOT EXISTS comm_message (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES comm_channel(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES user_account(id) ON DELETE SET NULL,
    
    type comm_message_type NOT NULL DEFAULT 'text',
    content TEXT NOT NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The Push-to-Talk Queue. 
-- This handles the "Request Channel" button state.
CREATE TABLE IF NOT EXISTS comm_radio_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES comm_channel(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    
    status comm_radio_status NOT NULL DEFAULT 'requested',
    
    -- Higher number = higher priority. 
    -- Example: Responders get 100, Peers get 10.
    priority SMALLINT NOT NULL DEFAULT 0, 
    
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_speaking_at TIMESTAMPTZ,
    ended_speaking_at TIMESTAMPTZ
);

-- ============================================================
-- 3. INDEXES
-- ============================================================

-- Fast lookup for an incident's active channel.
CREATE INDEX idx_comm_channel_incident ON comm_channel(incident_id) WHERE status = 'active';

-- Fast lookup for a user's active channels.
CREATE INDEX idx_comm_participant_user ON comm_participant(user_id) WHERE left_at IS NULL;

-- Fast chat pagination (newest first).
CREATE INDEX idx_comm_message_channel ON comm_message(channel_id, created_at DESC);

-- The most critical index: 
-- Finds the current speaker or the next in queue efficiently. 
-- Orders by priority (DESC) so Responders bypass Peers, then by time (ASC).
CREATE INDEX idx_comm_radio_active ON comm_radio_queue(channel_id, status, priority DESC, requested_at ASC);

-- ============================================================
-- 4. TRIGGERS
-- ============================================================

-- Automatically close the comms channel when the incident resolves.
CREATE OR REPLACE FUNCTION close_comm_channel_on_incident_resolve()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'RESOLVED' AND OLD.status != 'RESOLVED' THEN
        UPDATE comm_channel 
        SET status = 'archived', closed_at = now() 
        WHERE incident_id = NEW.id AND status = 'active';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_close_comm_channel
AFTER UPDATE ON incident
FOR EACH ROW
EXECUTE FUNCTION close_comm_channel_on_incident_resolve();

-- ============================================================
-- 5. VIEWS
-- ============================================================

-- A helpful view for the UI to render the "Talk Queue" list exactly as shown in the screenshot.
-- It combines the queue state with user profile data.
CREATE OR REPLACE VIEW comm_radio_queue_view AS
SELECT 
    q.id AS queue_id,
    q.channel_id,
    q.status,
    q.priority,
    u.id AS user_id,
    u.f_name || ' ' || u.l_name AS user_name,
    r.agency AS responder_agency,
    q.requested_at
FROM comm_radio_queue q
JOIN user_account u ON u.id = q.user_id
LEFT JOIN r_profile r ON r.user_id = q.user_id
WHERE q.status IN ('requested', 'speaking')
ORDER BY 
    CASE WHEN q.status = 'speaking' THEN 0 ELSE 1 END, -- Current speaker is always #1
    q.priority DESC, 
    q.requested_at ASC;


-- Down Migration

DROP VIEW IF EXISTS comm_radio_queue_view;
DROP TRIGGER IF EXISTS trg_close_comm_channel ON incident;
DROP FUNCTION IF EXISTS close_comm_channel_on_incident_resolve();
DROP TABLE IF EXISTS comm_radio_queue CASCADE;
DROP TABLE IF EXISTS comm_message CASCADE;
DROP TABLE IF EXISTS comm_participant CASCADE;
DROP TABLE IF EXISTS comm_channel CASCADE;
DROP TYPE IF EXISTS comm_radio_status;
DROP TYPE IF EXISTS comm_message_type;
DROP TYPE IF EXISTS comm_participant_role;
DROP TYPE IF EXISTS comm_channel_status;