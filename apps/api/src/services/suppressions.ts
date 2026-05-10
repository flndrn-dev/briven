import { eq } from 'drizzle-orm';

import { newId } from '@briven/shared';

import { getDb } from '../db/client.js';
import { emailSuppressions, type NewEmailSuppression, type EmailSuppression } from '../db/schema.js';
import { log } from '../lib/logger.js';

export type SuppressionReason = 'permanent_bounce' | 'complaint' | 'mittera_suppressed' | 'manual';

/**
 * Lower-case + trim so equality lookups match regardless of casing
 * the recipient typed in. Same normalisation used at insert time.
 */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Returns true when the recipient is in the suppression list — used
 * by the outbound path in lib/email.ts to short-circuit before we
 * call mittera (cheaper than a 4xx + retry storm).
 */
export async function isSuppressed(email: string): Promise<boolean> {
  const db = getDb();
  const norm = normaliseEmail(email);
  const rows = await db
    .select({ id: emailSuppressions.id })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.email, norm))
    .limit(1);
  return rows.length > 0;
}

/**
 * Idempotent insert — if the email is already suppressed we keep the
 * earliest reason on record (don't downgrade complaint→bounce or
 * vice-versa). Returns the row that's now live.
 */
export async function suppress(args: {
  email: string;
  reason: SuppressionReason;
  detail?: string | null;
  sourceEventId?: string | null;
}): Promise<EmailSuppression | null> {
  const db = getDb();
  const norm = normaliseEmail(args.email);
  if (!norm) return null;

  const row: NewEmailSuppression = {
    id: newId('sup'),
    email: norm,
    reason: args.reason,
    detail: args.detail ?? null,
    sourceEventId: args.sourceEventId ?? null,
  };

  try {
    const [inserted] = await db
      .insert(emailSuppressions)
      .values(row)
      .onConflictDoNothing({ target: emailSuppressions.email })
      .returning();
    return inserted ?? null;
  } catch (err) {
    log.warn('suppression_insert_failed', {
      email: norm,
      reason: args.reason,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function unsuppress(email: string): Promise<boolean> {
  const db = getDb();
  const norm = normaliseEmail(email);
  const deleted = await db
    .delete(emailSuppressions)
    .where(eq(emailSuppressions.email, norm))
    .returning({ id: emailSuppressions.id });
  return deleted.length > 0;
}

export async function listSuppressions(limit = 200): Promise<EmailSuppression[]> {
  const db = getDb();
  return db
    .select()
    .from(emailSuppressions)
    .orderBy(emailSuppressions.createdAt)
    .limit(limit);
}
