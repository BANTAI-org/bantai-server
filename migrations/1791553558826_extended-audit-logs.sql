-- 010
-- Up Migration
-- Extend audit_action enum coverage and provision H1 2027 partitions 
-- to prevent system_audit_log_default spill locks.

-- ============================================================
-- 1. EXTEND AUDIT_ACTION ENUM
-- ============================================================
-- Note: 'IF NOT EXISTS' for ADD VALUE requires PostgreSQL 12+
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'LINK_IDENTITY';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'UNLINK_IDENTITY';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'VERIFY_PHONE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'VERIFY_EMAIL';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CHANGE_DUTY_STATUS';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'AUTO_EXPIRE_SHIFT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'UPDATE_DRIVER_PROFILE';


-- ============================================================
-- 2. PROVISION 2027 AUDIT LOG PARTITIONS
-- ============================================================
-- Pre-creating H1 2027 partitions now guarantees the DEFAULT partition 
-- remains empty when January 1, 2027 hits.
CREATE TABLE IF NOT EXISTS system_audit_log_y2027m01 PARTITION OF system_audit_log
    FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

CREATE TABLE IF NOT EXISTS system_audit_log_y2027m02 PARTITION OF system_audit_log
    FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');

CREATE TABLE IF NOT EXISTS system_audit_log_y2027m03 PARTITION OF system_audit_log
    FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');

CREATE TABLE IF NOT EXISTS system_audit_log_y2027m04 PARTITION OF system_audit_log
    FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');

CREATE TABLE IF NOT EXISTS system_audit_log_y2027m05 PARTITION OF system_audit_log
    FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');

CREATE TABLE IF NOT EXISTS system_audit_log_y2027m06 PARTITION OF system_audit_log
    FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');


-- Down Migration
-- PostgreSQL does not support dropping enum values (`ALTER TYPE ... DROP VALUE`). 
-- To rollback enum additions in production, you would have to swap the type completely.
--
-- DROP TABLE IF EXISTS system_audit_log_y2027m06;
-- DROP TABLE IF EXISTS system_audit_log_y2027m05;
-- DROP TABLE IF EXISTS system_audit_log_y2027m04;
-- DROP TABLE IF EXISTS system_audit_log_y2027m03;
-- DROP TABLE IF EXISTS system_audit_log_y2027m02;
-- DROP TABLE IF EXISTS system_audit_log_y2027m01;