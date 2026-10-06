-- 008
-- Up Migration
-- 008: replace incident.snapshot_urls with references to the dual-camera video
-- clips stored in Cloudflare R2.
--
-- The dashcam is a dual 120-degree camera (front + rear view). The edge device
-- uploads one clip per view to R2, and the database keeps only the OBJECT KEY,
-- never a URL:
--   * A URL bakes in the account/bucket host and, for a private bucket, an
--     expiring signature. Both go stale. The bucket name lives in config; the
--     API turns a key into a short-lived presigned GET URL for whoever is
--     allowed to watch it.
--   * Suggested key convention: incidents/<incident_id>/front.mp4 and
--     incidents/<incident_id>/rear.mp4
--
-- NULL means "no clip": not uploaded yet, or the incident never had a camera
-- (MANUAL_SOS and CENTER_MANUAL incidents don't). The two views upload
-- independently, so either can be set without the other. Set a key only once
-- the upload is CONFIRMED, so nobody is handed a key that points at nothing.
--
-- PRE-FLIGHT: this DROPS snapshot_urls. If any rows hold data you care about,
-- copy it out first:
--   SELECT id, snapshot_urls FROM incident WHERE jsonb_array_length(snapshot_urls) > 0;

ALTER TABLE incident DROP CONSTRAINT IF EXISTS chck_incident_snapshot_urls_is_array;
ALTER TABLE incident DROP COLUMN snapshot_urls;

ALTER TABLE incident
    ADD COLUMN front_clip_key TEXT,
    ADD COLUMN rear_clip_key TEXT;

-- "A key, not a URL": non-blank, at most 1024 bytes (the S3/R2 key limit), and
-- no scheme (https://, s3://, ...) or leading slash. This is what catches the
-- old habit of storing a full URL.
ALTER TABLE incident
    ADD CONSTRAINT chck_incident_front_clip_key CHECK (
        front_clip_key IS NULL OR (
            btrim(front_clip_key) <> ''
            AND octet_length(front_clip_key) <= 1024
            AND front_clip_key !~ '^([A-Za-z][A-Za-z0-9+.-]*://|/)'
        )
    ),
    ADD CONSTRAINT chck_incident_rear_clip_key CHECK (
        rear_clip_key IS NULL OR (
            btrim(rear_clip_key) <> ''
            AND octet_length(rear_clip_key) <= 1024
            AND rear_clip_key !~ '^([A-Za-z][A-Za-z0-9+.-]*://|/)'
        )
    ),
    -- Two different cameras can't be the same file. (NULL on either side
    -- passes: a CHECK only fails when it evaluates to false.)
    ADD CONSTRAINT chck_incident_clip_keys_differ CHECK (
        front_clip_key <> rear_clip_key
    );

-- One clip belongs to one incident, and the index doubles as the lookup for
-- "which incident is this uploaded object for?" (e.g. from an R2 event).
-- Uniqueness is per column: a key can't be the front clip of two incidents.
-- (The same key used as front of one incident and rear of another would not be
-- caught; the key convention above makes that mistake very unlikely.)
CREATE UNIQUE INDEX uq_incident_front_clip_key
    ON incident (front_clip_key) WHERE front_clip_key IS NOT NULL;
CREATE UNIQUE INDEX uq_incident_rear_clip_key
    ON incident (rear_clip_key) WHERE rear_clip_key IS NOT NULL;


-- Down Migration
-- Restores the empty snapshot_urls column. Any clip keys recorded since the
-- up migration are lost.
DROP INDEX IF EXISTS uq_incident_rear_clip_key;
DROP INDEX IF EXISTS uq_incident_front_clip_key;

ALTER TABLE incident
    DROP CONSTRAINT IF EXISTS chck_incident_clip_keys_differ,
    DROP CONSTRAINT IF EXISTS chck_incident_rear_clip_key,
    DROP CONSTRAINT IF EXISTS chck_incident_front_clip_key;

ALTER TABLE incident
    DROP COLUMN IF EXISTS rear_clip_key,
    DROP COLUMN IF EXISTS front_clip_key;

ALTER TABLE incident ADD COLUMN snapshot_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE incident ADD CONSTRAINT chck_incident_snapshot_urls_is_array
    CHECK (jsonb_typeof(snapshot_urls) = 'array');