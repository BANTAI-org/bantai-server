import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'HasKeyOrUrl', async: false })
export class HasKeyOrUrlConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    // We inspect the whole object being validated, not just the dummy property
    const record = args.object as Record<string, unknown>;

    const hasKey = typeof record.key === 'string' && record.key.trim() !== '';
    const hasUrl = typeof record.url === 'string' && record.url.trim() !== '';

    return hasKey || hasUrl;
  }

  defaultMessage(): string {
    return 'An evidence item must have at least a non-blank "key" (R2 object key) or a non-blank "url".';
  }
}
