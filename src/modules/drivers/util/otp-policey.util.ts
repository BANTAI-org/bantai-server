export const BCRYPT_ROUNDS = 12;

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_CHECK_VIOLATION = '23514';
export const PG_NOT_NULL_VIOLATION = '23502';
export const PG_DATA_EXCEPTION_CLASS = '22';

// Forgot-password
export const RESET_OTP_PURPOSE = 'password_reset';
export const RESET_RESEND_COOLDOWN_SECONDS = 60;
export const RESET_MAX_SENDS_PER_HOUR = 5;
export const RESET_MAX_VERIFY_ATTEMPTS = 5;
export const HOUR_SECONDS = 3600;
export const INVALID_CODE_MESSAGE = 'Invalid or expired verification code';
