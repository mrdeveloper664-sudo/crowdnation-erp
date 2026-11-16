import { registerDecorator, ValidationOptions } from 'class-validator';

/** Money as a decimal STRING ("1234.50"): JSON numbers are never trusted for amounts. */
export function IsMoney(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isMoney', target: object.constructor, propertyName, options: { message: `${propertyName} must be a decimal string with up to 4 decimals`, ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && /^\d{1,15}(\.\d{1,4})?$/.test(v) },
    });
}

export const IsoDate = /^\d{4}-\d{2}-\d{2}$/;
