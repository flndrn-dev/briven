import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Parse to a valid Date, or null — NEVER throws. Guards every dashboard date
 * render: `new Date(bad).toISOString()` throws "Invalid time value", which in a
 * server component crashes the whole page into a 500. Callers should format
 * `toValidDate(x)` and fall back (e.g. '—') when it's null, instead of
 * formatting a raw `new Date(x)` that might be an Invalid Date.
 */
export function toValidDate(input: string | number | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}
