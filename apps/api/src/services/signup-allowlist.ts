import { newId, ValidationError } from '@briven/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { signupAllowlist, type SignupAllowlistEntry } from '../db/schema.js';

/**
 * Invite-only beta gate. When `BRIVEN_OPEN_SIGNUPS=false`, Better
 * Auth's `user.create.before` hook (configured in lib/auth.ts) calls
 * `isEmailAllowed` and rejects any signup whose email isn't on this
 * list. An admin manages entries via /dashboard/admin/allowlist.
 *
 * The check is case-insensitive and trims whitespace — we normalise on
 * write + read so "Foo@example.com" and "foo@example.com " resolve to
 * the same allowlist row.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalise(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(email: string): string {
  const cleaned = normalise(email);
  if (!EMAIL_RE.test(cleaned)) {
    throw new ValidationError('not a valid email address');
  }
  return cleaned;
}

export async function listAllowlist(): Promise<SignupAllowlistEntry[]> {
  const db = getDb();
  return db.select().from(signupAllowlist).orderBy(desc(signupAllowlist.invitedAt));
}

export async function isEmailAllowed(email: string): Promise<boolean> {
  const cleaned = normalise(email);
  const db = getDb();
  const rows = await db
    .select({ id: signupAllowlist.id })
    .from(signupAllowlist)
    .where(eq(signupAllowlist.email, cleaned))
    .limit(1);
  return rows.length > 0;
}

export interface AddEntryInput {
  email: string;
  invitedBy: string | null;
  notes?: string | null;
}

export async function addToAllowlist(input: AddEntryInput): Promise<SignupAllowlistEntry> {
  const email = validateEmail(input.email);
  const db = getDb();
  try {
    const inserted = await db
      .insert(signupAllowlist)
      .values({
        id: newId('al'),
        email,
        invitedBy: input.invitedBy,
        notes: input.notes ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('insert returned no row');
    return row;
  } catch (err) {
    // drizzle wraps the pg error in DrizzleQueryError whose own .message is
    // "Failed query: …"; the unique-violation text is on `.cause`. Check both,
    // or a duplicate invite surfaces as a raw 500 instead of this clean 400.
    const cause = err instanceof Error ? (err.cause as { message?: string } | undefined) : undefined;
    const text = err instanceof Error ? `${err.message} ${cause?.message ?? ''}` : String(err);
    if (/unique|duplicate/i.test(text)) {
      throw new ValidationError(`${email} is already on the allowlist`);
    }
    throw err;
  }
}

export async function removeFromAllowlist(email: string): Promise<boolean> {
  const cleaned = normalise(email);
  const db = getDb();
  const result = await db
    .delete(signupAllowlist)
    .where(eq(signupAllowlist.email, cleaned))
    .returning({ id: signupAllowlist.id });
  return result.length > 0;
}

/**
 * Stamp `accepted_at` on the matching row when an allowlisted email
 * actually signs up. Called from the Better Auth `user.create.after`
 * hook. Idempotent — repeat signups (e.g. magic-link re-flows) are
 * fine; the first one wins and the rest no-op via the WHERE clause.
 */
export async function markAllowlistAccepted(email: string): Promise<void> {
  const cleaned = normalise(email);
  const db = getDb();
  await db
    .update(signupAllowlist)
    .set({ acceptedAt: new Date() })
    .where(and(eq(signupAllowlist.email, cleaned), isNull(signupAllowlist.acceptedAt)));
}
