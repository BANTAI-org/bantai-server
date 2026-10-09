-- 008
-- Up Migration
-- 008: replace incident.snapshot_urls with a single JSONB `evidence` column
-- that references the evidence files (dashcam front/rear clips, snapshots,
-- anything else) stored in Cloudflare R2.
--
-- SHAPE: a JSON array of objects, one per evidence item, e.g.
--
--   [
--     {"key": "incidents/<id>/front.mp4", "view": "front", "type": "video",
--      "content_type": "video/mp4", "size_bytes": 18234112},
--     {"key": "incidents/<id>/rear.mp4",  "view": "rear",  "type": "video"},
--     {"key": "incidents/<id>/snap1.jpg", "type": "image"},
--     {"url": "https://example.com/some-external-evidence.jpg"}
--   ]
--
-- The only rule the database enforces is on the identifier: every element must
-- be an object carrying a non-blank "key" (R2 object key) and/or a non-blank
-- "url". Every other field ("view", "type", "content_type", "size_bytes",
-- "uploaded_at", "duration_s", ...) is free-form, so new reference fields need
-- no migration.
--
-- PREFER "key" OVER "url" for R2 objects. A URL bakes in the account/bucket
-- host and, for a private bucket, an expiring signature; both go stale. Store
-- the key, keep the bucket name in config, and let the API turn a key into a
-- short-lived presigned GET URL for whoever is allowed to watch it. "url" is
-- accepted for evidence that lives outside R2 and for legacy rows.
--
-- An empty array means "no evidence": not uploaded yet, or the incident never
-- had a camera (MANUAL_SOS and CENTER_MANUAL incidents don't). Append an item
-- only once its upload is CONFIRMED, so nobody is handed a reference that
-- points at nothing.
--
-- PRE-FLIGHT: this DROPS snapshot_urls after copying it into `evidence`
-- (each old string URL becomes {"url": "<string>"}). Rows whose snapshot_urls
-- hold something other than non-blank strings or objects will fail the
-- constraint below, by design; check first (should return zero rows):
--   SELECT id FROM incident, jsonb_array_elements(snapshot_urls) v
--    WHERE jsonb_typeof(v) NOT IN ('string', 'object')
--       OR (jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') = '');

-- ============================================================
-- 1. VALIDATOR
-- ============================================================
-- A CHECK constraint can't contain a subquery, so the per-element rules live
-- in an IMMUTABLE function. CASE guarantees jsonb_array_elements only runs on
-- an actual array.
CREATE OR REPLACE FUNCTION is_valid_incident_evidence(j jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN j IS NULL OR jsonb_typeof(j) <> 'array' THEN false
        WHEN jsonb_array_length(j) > 100 THEN false
        ELSE NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(j) AS e
            WHERE jsonb_typeof(e) <> 'object'
               OR NOT (e ? 'key' OR e ? 'url')
               OR (e ? 'key' AND (
                       jsonb_typeof(e -> 'key') <> 'string'
                    OR btrim(e ->> 'key') = ''
                    OR octet_length(e ->> 'key') > 1024      -- S3/R2 key limit
                    OR (e ->> 'key') ~ '^([A-Za-z][A-Za-z0-9+.-]*://|/)' -- no scheme / leading slash
               ))
               OR (e ? 'url' AND (
                       jsonb_typeof(e -> 'url') <> 'string'
                    OR btrim(e ->> 'url') = ''
               ))
        )
    END
$$;

-- ============================================================
-- 2. REPLACE snapshot_urls WITH evidence
-- ============================================================
ALTER TABLE incident
    ADD COLUMN evidence JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Carry existing snapshot URLs over as {"url": ...} items.
UPDATE incident
SET evidence = (
    SELECT COALESCE(
        jsonb_agg(
            CASE WHEN jsonb_typeof(v) = 'string'
                 THEN jsonb_build_object('url', v #>> '{}')
                 ELSE v
            END
        ),
        '[]'::jsonb)
    FROM jsonb_array_elements(snapshot_urls) AS v
)
WHERE jsonb_array_length(snapshot_urls) > 0;

ALTER TABLE incident DROP CONSTRAINT IF EXISTS chck_incident_snapshot_urls_is_array;
ALTER TABLE incident DROP COLUMN snapshot_urls;

ALTER TABLE incident
    ADD CONSTRAINT chck_incident_evidence_valid
    CHECK (is_valid_incident_evidence(evidence));

-- ============================================================
-- 3. LOOKUP INDEX
-- ============================================================
-- Answers "which incident is this uploaded object for?" (e.g. from an R2
-- event notification):
--   SELECT id FROM incident WHERE evidence @> '[{"key": "incidents/<id>/front.mp4"}]';
-- jsonb_path_ops is smaller and faster than the default GIN opclass and fully
-- supports @> containment, which is all this lookup needs.
-- NOTE: unlike the old per-column unique indexes, this does NOT stop the same
-- key being attached to two incidents. The key convention
-- (incidents/<incident_id>/...) makes that mistake very unlikely; enforce
-- anything stricter in the app layer.
CREATE INDEX idx_incident_evidence
    ON incident USING GIN (evidence jsonb_path_ops);


-- Down Migration
-- Restores snapshot_urls as an array of URL strings, filled from any evidence
-- items that carry a "url". Items that only have a "key" (and any other
-- fields) are lost.
DROP INDEX IF EXISTS idx_incident_evidence;

ALTER TABLE incident ADD COLUMN snapshot_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE incident
SET snapshot_urls = (
    SELECT COALESCE(jsonb_agg(e ->> 'url'), '[]'::jsonb)
    FROM jsonb_array_elements(evidence) AS e
    WHERE e ? 'url'
)
WHERE jsonb_array_length(evidence) > 0;

ALTER TABLE incident ADD CONSTRAINT chck_incident_snapshot_urls_is_array
    CHECK (jsonb_typeof(snapshot_urls) = 'array');

ALTER TABLE incident DROP CONSTRAINT IF EXISTS chck_incident_evidence_valid;
ALTER TABLE incident DROP COLUMN IF EXISTS evidence;

DROP FUNCTION IF EXISTS is_valid_incident_evidence(jsonb);