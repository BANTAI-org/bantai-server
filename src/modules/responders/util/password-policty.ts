export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 72;
export const PASSWORD_PATTERN = /^(?=.*\d)(?=.*[A-Z])(?=.*[^A-Za-z0-9\s]).+$/;
export const PASSWORD_POLICY_MESSAGE =
  'password must include at least one number, one capital letter, and one special character';
