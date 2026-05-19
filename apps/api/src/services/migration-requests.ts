import { newId, NotFoundError, ValidationError } from '@briven/shared';
import { desc, eq, notInArray } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  migrationRequests,
  migrationSources,
  migrationStatuses,
  migrationUrgencies,
  users,
  type MigrationRequest,
  type MigrationSource,
  type MigrationStatus,
  type MigrationUrgency,
} from '../db/schema.js';

const SOURCE_NOTES_CAP = 8_000;
const OPERATOR_NOTES_CAP = 20_000;
const URL_CAP = 2_000;
const EMAIL_CAP = 320;

export interface CreateMigrationRequestInput {
  // Null for unauthenticated leads submitted via the /migrate marketing
  // form. Operator can patch a user_id later from the admin triage row.
  userId: string | null;
  orgId?: string | null;
  source: string;
  sourceUrl?: string | null;
  sourceNotes?: string;
  estimatedTables?: number | null;
  estimatedRows?: bigint | null;
  estimatedFunctions?: number | null;
  urgency?: string;
  contactEmail: string;
}

function assertSource(s: string): asserts s is MigrationSource {
  if (!(migrationSources as readonly string[]).includes(s)) {
    throw new ValidationError(
      `source must be one of: ${migrationSources.join(', ')}`,
    );
  }
}

function assertUrgency(u: string): asserts u is MigrationUrgency {
  if (!(migrationUrgencies as readonly string[]).includes(u)) {
    throw new ValidationError(
      `urgency must be one of: ${migrationUrgencies.join(', ')}`,
    );
  }
}

function assertStatus(s: string): asserts s is MigrationStatus {
  if (!(migrationStatuses as readonly string[]).includes(s)) {
    throw new ValidationError(
      `status must be one of: ${migrationStatuses.join(', ')}`,
    );
  }
}

function assertNonNegativeInt(value: number | null | undefined, field: string): void {
  if (value == null) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${field} must be a non-negative integer`);
  }
}

function assertNonNegativeBigint(value: bigint | null | undefined, field: string): void {
  if (value == null) return;
  if (value < 0n) {
    throw new ValidationError(`${field} must be non-negative`);
  }
}

function trimWithCap(s: string | undefined | null, cap: number, field: string): string {
  const trimmed = (s ?? '').trim();
  if (trimmed.length > cap) {
    throw new ValidationError(`${field} exceeds ${cap}-character cap`);
  }
  return trimmed;
}

function assertEmail(email: string): void {
  if (email.length > EMAIL_CAP) {
    throw new ValidationError(`contact email exceeds ${EMAIL_CAP}-character cap`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('contact email is not a valid address');
  }
}

export async function createMigrationRequest(
  input: CreateMigrationRequestInput,
): Promise<MigrationRequest> {
  assertSource(input.source);
  const urgency = input.urgency ?? 'exploring';
  assertUrgency(urgency);
  const contactEmail = (input.contactEmail ?? '').trim();
  if (!contactEmail) throw new ValidationError('contact email is required');
  assertEmail(contactEmail);
  const sourceUrl = trimWithCap(input.sourceUrl, URL_CAP, 'source url') || null;
  const sourceNotes = trimWithCap(input.sourceNotes, SOURCE_NOTES_CAP, 'source notes');
  assertNonNegativeInt(input.estimatedTables, 'estimated tables');
  assertNonNegativeInt(input.estimatedFunctions, 'estimated functions');
  assertNonNegativeBigint(input.estimatedRows, 'estimated rows');

  const db = getDb();
  const [row] = await db
    .insert(migrationRequests)
    .values({
      id: newId('mig'),
      userId: input.userId ?? null,
      orgId: input.orgId ?? null,
      source: input.source,
      sourceUrl,
      sourceNotes,
      estimatedTables: input.estimatedTables ?? null,
      estimatedRows: input.estimatedRows ?? null,
      estimatedFunctions: input.estimatedFunctions ?? null,
      urgency,
      contactEmail,
      status: 'new',
    })
    .returning();
  if (!row) throw new Error('insert returned no row');
  return row;
}

export async function listMigrationRequestsForUser(
  userId: string,
  opts: { limit?: number } = {},
): Promise<MigrationRequest[]> {
  const db = getDb();
  return db
    .select()
    .from(migrationRequests)
    .where(eq(migrationRequests.userId, userId))
    .orderBy(desc(migrationRequests.createdAt))
    .limit(Math.min(100, Math.max(1, opts.limit ?? 50)));
}

export async function listMigrationRequestsForAdmin(
  opts: { limit?: number; openOnly?: boolean } = {},
): Promise<MigrationRequest[]> {
  const db = getDb();
  const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
  if (opts.openOnly) {
    return db
      .select()
      .from(migrationRequests)
      .where(notInArray(migrationRequests.status, ['completed', 'cancelled']))
      .orderBy(desc(migrationRequests.createdAt))
      .limit(limit);
  }
  return db
    .select()
    .from(migrationRequests)
    .orderBy(desc(migrationRequests.createdAt))
    .limit(limit);
}

/**
 * Hard-delete a migration request the caller owns. Cascades to the
 * request's audit-event rows via the FK. Returns `false` when the row
 * doesn't exist or belongs to a different user — same shape for both so
 * the endpoint never leaks which case applied.
 */
export async function deleteMigrationRequestForUser(
  id: string,
  userId: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select()
    .from(migrationRequests)
    .where(eq(migrationRequests.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return false;
  if (row.userId !== userId) return false;
  await db.delete(migrationRequests).where(eq(migrationRequests.id, id));
  return true;
}

export async function getMigrationRequest(id: string): Promise<MigrationRequest> {
  const db = getDb();
  const rows = await db
    .select()
    .from(migrationRequests)
    .where(eq(migrationRequests.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('migration_request', id);
  return row;
}

export interface UpdateMigrationRequestInput {
  status?: string;
  assignedTo?: string | null;
  operatorNotes?: string;
}

/**
 * Operator-driven: link an unauth lead to an existing briven user.
 * Used when the customer who left a /migrate lead has since (or
 * already) signed up under the same email — the operator clicks
 * "promote to user" in the admin row and the request's user_id is
 * patched. Idempotent: a request already linked to the same user
 * is a no-op.
 */
export async function promoteMigrationRequestToUser(
  requestId: string,
  contactEmail: string,
): Promise<{ request: MigrationRequest; linkedUserId: string | null }> {
  const db = getDb();
  const request = await getMigrationRequest(requestId);
  // Resolve by the request's own contactEmail (admin doesn't pass user
  // id — they pass intent) so we never link to the wrong account.
  // contactEmail param is the recorded one, passed by the caller for
  // explicitness in the audit log.
  if (request.contactEmail.toLowerCase() !== contactEmail.toLowerCase()) {
    throw new ValidationError(
      'contact email mismatch — refusing to promote to a user who is not the lead',
    );
  }
  const candidates = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, contactEmail.toLowerCase()))
    .limit(1);
  const candidate = candidates[0];
  if (!candidate) {
    return { request, linkedUserId: null };
  }
  if (request.userId === candidate.id) {
    return { request, linkedUserId: candidate.id };
  }
  const [updated] = await db
    .update(migrationRequests)
    .set({ userId: candidate.id, updatedAt: new Date() })
    .where(eq(migrationRequests.id, requestId))
    .returning();
  if (!updated) throw new NotFoundError('migration_request', requestId);
  return { request: updated, linkedUserId: candidate.id };
}

export async function updateMigrationRequest(
  id: string,
  input: UpdateMigrationRequestInput,
): Promise<MigrationRequest> {
  const patch: {
    status?: MigrationStatus;
    assignedTo?: string | null;
    operatorNotes?: string;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (input.status !== undefined) {
    assertStatus(input.status);
    patch.status = input.status;
  }
  if (input.assignedTo !== undefined) {
    patch.assignedTo = input.assignedTo === '' ? null : input.assignedTo;
  }
  if (input.operatorNotes !== undefined) {
    patch.operatorNotes = trimWithCap(
      input.operatorNotes,
      OPERATOR_NOTES_CAP,
      'operator notes',
    );
  }

  const db = getDb();
  const [row] = await db
    .update(migrationRequests)
    .set(patch)
    .where(eq(migrationRequests.id, id))
    .returning();
  if (!row) throw new NotFoundError('migration_request', id);
  return row;
}
