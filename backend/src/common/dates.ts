import { BadRequestException } from '@nestjs/common';

/** Parse "YYYY-MM-DD" into a UTC-midnight Date (matches PostgreSQL DATE columns). */
export function parseDate(value: string, field = 'date'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${field} must be YYYY-MM-DD`);
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} is not a valid calendar date`);
  }
  return d;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
