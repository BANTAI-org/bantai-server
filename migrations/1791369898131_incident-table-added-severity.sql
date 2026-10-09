-- 009
-- Up Migration
-- 009: WHAT was detected (threat_type) and HOW BAD it is (severity).
--
-- detected_class stays as the RAW label from the camera model (free text on
-- purpose: the label set changes faster than a schema should). threat_type is
-- the canonical type the system acts on, mapped from that label in ONE place in
-- code. Adding a type later is a deliberate product decision, so a migration
-- is fine for this one.
--
-- severity is deliberately separate from threat_category:
--   threat_category  "is there an adversary?"  -> governs who may CLOSE the incident
--   severity         "how hurt / how urgent?"  -> governs how hard to RESPOND
-- A collision can be a scraped knee or a rider pinned under a truck; both are
-- ASSIST (no adversary), but they need very different responses.
--
--   UNKNOWN   not assessed yet (default). Dispatch should treat it as SERIOUS
--             until someone assesses it, same "assume danger" stance as
--             threat_level's default.
--   MINOR     rider is OK or lightly hurt, can walk and talk.
--   SERIOUS   injured; needs medical attention or transport.
--   CRITICAL  life-threatening: unresponsive, trapped or pinned, or fatal.
--
-- PRE-FLIGHT: the weapon rule below fails (by design) if a gun/blade incident
-- is not already HAZARD. Run this first; it should return zero rows:
--   SELECT id, detected_class, threat_category FROM incident
--    WHERE lower(btrim(detected_class)) IN ('gun', 'blade')
--      AND threat_category <> 'HAZARD';

CREATE TYPE threat_type_enum AS ENUM (
    'GUN',
    'BLADE',
    'CONFRONTATION',
    'COLLISION',
    'PERSON_DOWN',
    'OTHER'
);

CREATE TYPE incident_severity_enum AS ENUM (
    'UNKNOWN',
    'MINOR',
    'SERIOUS',
    'CRITICAL'
);

ALTER TABLE incident
    ADD COLUMN threat_type threat_type_enum NOT NULL DEFAULT 'OTHER',
    ADD COLUMN severity incident_severity_enum NOT NULL DEFAULT 'UNKNOWN';

-- History: give existing rows a type where the raw label is unambiguous.
-- 'person' is NOT mapped: it could mean several things, so it stays OTHER.
UPDATE incident
SET threat_type = CASE lower(btrim(detected_class))
        WHEN 'gun'       THEN 'GUN'::threat_type_enum
        WHEN 'blade'     THEN 'BLADE'::threat_type_enum
        WHEN 'collision' THEN 'COLLISION'::threat_type_enum
    END
WHERE lower(btrim(detected_class)) IN ('gun', 'blade', 'collision');

-- The point of the column: a weapon can never be filed as something a single
-- responder is allowed to close. The closure rule (chck_incident_resolution_safety_gate)
-- only reads threat_category, so this ties the type to it at the database level.
ALTER TABLE incident
    ADD CONSTRAINT chck_incident_weapon_is_hazard CHECK (
        threat_type NOT IN ('GUN', 'BLADE') OR threat_category = 'HAZARD'
    ),
    ADD CONSTRAINT chck_incident_confrontation_not_assist CHECK (
        threat_type <> 'CONFRONTATION' OR threat_category <> 'ASSIST'
    );


-- Down Migration
ALTER TABLE incident
    DROP CONSTRAINT IF EXISTS chck_incident_confrontation_not_assist,
    DROP CONSTRAINT IF EXISTS chck_incident_weapon_is_hazard;

ALTER TABLE incident
    DROP COLUMN IF EXISTS severity,
    DROP COLUMN IF EXISTS threat_type;

DROP TYPE IF EXISTS incident_severity_enum;
DROP TYPE IF EXISTS threat_type_enum;