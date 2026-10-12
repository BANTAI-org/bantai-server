import { Transform } from 'class-transformer';

/** Trims surrounding whitespace from string values; leaves everything else alone. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * Like Trim, but a blank string becomes null. Use on optional free-text fields
 * so "   " is stored as "no value" instead of an empty string.
 */
export const TrimToNull = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  });
