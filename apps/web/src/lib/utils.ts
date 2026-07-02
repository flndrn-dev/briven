import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Parse a date-ish value (ISO string, epoch number, Date) into a valid
 * Date, or null when missing/unparseable — so callers can render '—'
 * instead of crashing on an "Invalid Date".
 */
export function toValidDate(value: unknown): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}
