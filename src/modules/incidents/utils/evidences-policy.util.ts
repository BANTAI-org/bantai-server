import { registerDecorator, ValidationOptions } from 'class-validator';
import { IncidentEvidenceItem } from '../types/evidence-item.type';

const SCHEME_OR_SLASH = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/|\/)/;
const nonBlank = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '';

export function isValidEvidence(
  value: unknown,
): value is IncidentEvidenceItem[] {
  if (!Array.isArray(value) || value.length > 100) return false;
  return value.every((e) => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return false;
    const hasKey = 'key' in e;
    const hasUrl = 'url' in e;
    if (!hasKey && !hasUrl) return false;
    if (hasKey) {
      const k = (e as Record<string, unknown>).key;
      if (
        !nonBlank(k) ||
        Buffer.byteLength(k) > 1024 ||
        SCHEME_OR_SLASH.test(k)
      ) {
        return false;
      }
    }
    if (hasUrl && !nonBlank((e as Record<string, unknown>).url)) return false;
    return true;
  });
}

export function IsIncidentEvidence(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isIncidentEvidence',
      target: object.constructor,
      propertyName,
      options: {
        message:
          'evidence must be an array (max 100) of objects with a valid "key" (no scheme or leading "/", max 1024 bytes) and/or a non-blank "url"',
        ...options,
      },
      validator: { validate: isValidEvidence },
    });
}
