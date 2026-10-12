import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * String must be at most `max` bytes in UTF-8. @MaxLength counts characters,
 * which under-counts multi-byte text; the evidence "key" limit in the database
 * (is_valid_incident_evidence, migration 008) is octet_length, i.e. bytes.
 */
export function MaxByteLength(max: number, options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'maxByteLength',
      target: object.constructor,
      propertyName,
      constraints: [max],
      options: {
        message: `$property must be at most ${max} bytes (UTF-8)`,
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max,
      },
    });
  };
}
