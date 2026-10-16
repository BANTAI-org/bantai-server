-- 013
-- Up Migration
-- 013: make 'deactivated' (added in 012) usable.
--
-- !! MUST RUN IN A LATER TRANSACTION THAN 012 !!
-- This file uses the enum value that 012 adds. Postgres refuses that inside
-- the same transaction (SQLSTATE 55P04). node-pg-migrate wraps ALL pending
-- migrations in ONE transaction by default, so run with:
--     node-pg-migrate up --no-single-transaction
-- (already set in the package.json "migrate" script), or apply one file at a
-- time with `up 1`.
--
-- 1. chck_auth_requirements only allowed pending_activation / active, so no row
--    could hold 'deactivated'. It now also allows it:
--      * staff (admin / responder / super): 'deactivated' with or without a
--        password. A pending_activation account can be deactivated before it
--        was ever activated, and then has no password. Going back to 'active'
--        still needs a password_hash (the 'active' branch is unchanged).
--      * drivers: 'active' or 'deactivated'. Still never pending_activation.
--
-- 2. Deactivating an account does what a soft delete already does: revoke its
--    sessions and take it off duty. Without this a deactivated user could keep
--    refreshing tokens, and a deactivated responder would stay 'on_duty' (and so
--    stay eligible for wave offers). Unlike revoke_sessions_on_soft_delete it
--    also takes a DRIVER off duty (d_profile.duty_status, added in 007).
--    It fires only when the status BECOMES 'deactivated'; reactivating restores
--    nothing: the person goes on duty again themselves.
--
-- STILL APP-LAYER (not enforceable here): login and token refresh must reject a
-- 'deactivated' account (an already-issued access token stays valid until it
-- expires), and account_action_token rows must not be issued for one.

-- ============================================================
-- 1. CHECK CONSTRAINT
-- ============================================================
ALTER TABLE user_account
    DROP CONSTRAINT IF EXISTS chck_auth_requirements,
    ADD CONSTRAINT chck_auth_requirements CHECK (
        (role IN ('admin', 'responder', 'super')
            AND (
                (account_status = 'pending_activation' AND password_hash IS NULL)
                OR (account_status = 'active' AND password_hash IS NOT NULL)
                OR account_status = 'deactivated'
            ))
        OR
        (role = 'driver' AND account_status IN ('active', 'deactivated'))
    );

-- ============================================================
-- 2. REVOKE SESSIONS / GO OFF DUTY ON DEACTIVATION
-- ============================================================
CREATE OR REPLACE FUNCTION revoke_sessions_on_deactivation()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.account_status = 'deactivated'
       AND OLD.account_status IS DISTINCT FROM NEW.account_status THEN
        UPDATE user_session
        SET is_revoked = true
        WHERE user_id = NEW.id AND is_revoked = false;

        UPDATE r_profile
        SET availability = 'off_duty'
        WHERE user_id = NEW.id;

        UPDATE d_profile
        SET duty_status = 'off_duty'
        WHERE user_id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_revoke_sessions_on_deactivation ON user_account;
CREATE TRIGGER trg_revoke_sessions_on_deactivation
AFTER UPDATE OF account_status ON user_account
FOR EACH ROW
EXECUTE FUNCTION revoke_sessions_on_deactivation();


-- Down Migration
-- Restores the constraint from 005. This FAILS if any row is still
-- 'deactivated': move those rows to another status first.
DROP TRIGGER IF EXISTS trg_revoke_sessions_on_deactivation ON user_account;
DROP FUNCTION IF EXISTS revoke_sessions_on_deactivation();

ALTER TABLE user_account
    DROP CONSTRAINT IF EXISTS chck_auth_requirements,
    ADD CONSTRAINT chck_auth_requirements CHECK (
        (role IN ('admin', 'responder', 'super')
            AND (
                (account_status = 'pending_activation' AND password_hash IS NULL)
                OR (account_status = 'active' AND password_hash IS NOT NULL)
            ))
        OR
        (role = 'driver' AND account_status = 'active')
    );