-- 012
-- Up Migration
-- 012: a 'deactivated' account status, and the audit actions that go with it.
--
-- THIS FILE ONLY ADDS THE VALUES. A new enum value cannot be used in the
-- transaction that adds it ("unsafe use of new value", SQLSTATE 55P04), and a
-- migration runner wraps each file in one transaction, so the rules that
-- mention 'deactivated' live in 013, which runs in a later transaction.
-- Until 013 is applied nothing can be set to 'deactivated':
-- chck_auth_requirements still only allows pending_activation / active.
--
-- Meaning assumed by 013: login is disabled, the data is kept, and it is
-- reversible. That is different from deleted_at (a soft delete).
--
-- DEACTIVATE_ACCOUNT / REACTIVATE_ACCOUNT mirror ACTIVATE_ACCOUNT (the first
-- activation of a provisioned account). Nothing writes them automatically: no
-- trigger audits user_account, so the app layer writes these audit rows.
--
-- Note: the type is account_status_enum (not account_status).
-- 'IF NOT EXISTS' for ADD VALUE requires PostgreSQL 12+.

ALTER TYPE account_status_enum ADD VALUE IF NOT EXISTS 'deactivated';

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'DEACTIVATE_ACCOUNT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'REACTIVATE_ACCOUNT';


-- Down Migration
-- PostgreSQL does not support dropping enum values (`ALTER TYPE ... DROP VALUE`).
-- To roll these back in production you would have to swap the types completely,
-- after moving every row off 'deactivated' and deleting the audit rows that use
-- the two new actions. Roll back 013 first.