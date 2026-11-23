-- Up Migration

DO $$
BEGIN
    -- 1. Check if 'dispatcher' exists in the enum
    IF EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'comm_participant_role' AND e.enumlabel = 'dispatcher'
    ) THEN
        -- 2. Check if 'observer' already exists (prevents crash if partially migrated)
        IF NOT EXISTS (
            SELECT 1 FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'comm_participant_role' AND e.enumlabel = 'observer'
        ) THEN
            -- 3. Safe to rename (Postgres automatically updates existing table rows)
            ALTER TYPE comm_participant_role RENAME VALUE 'dispatcher' TO 'observer';
        ELSE
            -- 4. Edge case: Both exist. Just migrate the data safely.
            UPDATE comm_participant SET role = 'observer' WHERE role = 'dispatcher';
        END IF;
    END IF;
END $$;

ALTER TABLE comm_channel ADD COLUMN IF NOT EXISTS cf_meeting_id VARCHAR(255);


-- Down Migration

ALTER TABLE comm_channel DROP COLUMN IF EXISTS cf_meeting_id;

DO $$
BEGIN
    -- 1. Check if 'observer' exists in the enum
    IF EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'comm_participant_role' AND e.enumlabel = 'observer'
    ) THEN
        -- 2. Check if 'dispatcher' already exists
        IF NOT EXISTS (
            SELECT 1 FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'comm_participant_role' AND e.enumlabel = 'dispatcher'
        ) THEN
            -- 3. Safe to rename back
            ALTER TYPE comm_participant_role RENAME VALUE 'observer' TO 'dispatcher';
        ELSE
            -- 4. Edge case: Both exist. Just migrate the data back.
            UPDATE comm_participant SET role = 'dispatcher' WHERE role = 'observer';
        END IF;
    END IF;
END $$;