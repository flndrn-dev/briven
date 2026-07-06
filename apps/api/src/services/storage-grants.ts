import { newId, NotFoundError, ValidationError } from '@briven/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { projectStorageGrants, type ProjectStorageGrant } from '../db/schema.js';
import { getFile } from './storage.js';

/**
 * Cross-project storage sharing — GRANTS (M5).
 *
 * This is the ONE sanctioned exception to strict cross-project storage
 * isolation. A GRANTER project explicitly shares either a single file (by file
 * id) or a whole path prefix with a GRANTEE project. The grantee can then mint a
 * download URL for exactly the granted resource — and nothing else.
 *
 * SECURITY MODEL (strict-deny by construction):
 *   - `isGranted()` returns true ONLY when an ACTIVE (revoked_at IS NULL) grant
 *     from granter→grantee covers the resource. No matching row, a revoked row,
 *     an unknown project, OR ANY error → false. It never throws.
 *   - Prefix grants match on the file's OBJECT PATH (`projects/<id>/<fileId>`),
 *     not the human name — the path is what actually addresses the bytes.
 *   - Only the granter may revoke its own grant (the service scopes every
 *     mutation by granterProjectId, so a grantee can never touch a grant row).
 *
 * The control-plane table is created idempotently on first use (CREATE TABLE IF
 * NOT EXISTS — same pattern as auth-origin-allowlist / storage-keys) so the code
 * is safe even before migration 0050 has been applied.
 */

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const db = getDb();
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS "project_storage_grants" (
        "id" text PRIMARY KEY NOT NULL,
        "granter_project_id" text NOT NULL,
        "grantee_project_id" text NOT NULL,
        "resource" text NOT NULL,
        "is_prefix" boolean DEFAULT false NOT NULL,
        "created_by" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "revoked_at" timestamp with time zone
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_storage_grants_unique_idx" ON "project_storage_grants" ("granter_project_id","grantee_project_id","resource")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "project_storage_grants_grantee_idx" ON "project_storage_grants" ("grantee_project_id")`,
    ),
  );
  tableReady = true;
}

export interface StorageGrantRecord {
  id: string;
  granterProjectId: string;
  granteeProjectId: string;
  resource: string;
  isPrefix: boolean;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
}

function toRecord(r: ProjectStorageGrant): StorageGrantRecord {
  const iso = (d: Date | null): string | null =>
    d ? (d instanceof Date ? d : new Date(d)).toISOString() : null;
  return {
    id: r.id,
    granterProjectId: r.granterProjectId,
    granteeProjectId: r.granteeProjectId,
    resource: r.resource,
    isPrefix: r.isPrefix,
    createdBy: r.createdBy ?? null,
    createdAt: iso(r.createdAt) ?? new Date().toISOString(),
    revokedAt: iso(r.revokedAt),
  };
}

export interface CreateGrantInput {
  granterProjectId: string;
  granteeProjectId: string;
  /** An exact file id (isPrefix=false) or a path prefix string (isPrefix=true). */
  resource: string;
  isPrefix: boolean;
  createdBy: string | null;
}

/**
 * Create (or re-activate) a grant. A granter can never grant to itself. When a
 * matching (granter, grantee, resource) row already exists we reactivate it
 * (clear revoked_at) rather than inserting a duplicate — this keeps the unique
 * index satisfied and makes re-granting a revoked resource a no-surprise op.
 */
export async function createGrant(input: CreateGrantInput): Promise<StorageGrantRecord> {
  const resource = input.resource?.trim();
  if (!resource) {
    throw new ValidationError('resource is required (a file id or a path prefix)');
  }
  if (input.granteeProjectId === input.granterProjectId) {
    throw new ValidationError('cannot grant a project access to its own storage');
  }
  await ensureTable();
  const db = getDb();

  // Re-activate an existing (possibly revoked) matching grant, else insert.
  const [existing] = await db
    .select()
    .from(projectStorageGrants)
    .where(
      and(
        eq(projectStorageGrants.granterProjectId, input.granterProjectId),
        eq(projectStorageGrants.granteeProjectId, input.granteeProjectId),
        eq(projectStorageGrants.resource, resource),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(projectStorageGrants)
      .set({ revokedAt: null, isPrefix: input.isPrefix, createdBy: input.createdBy })
      .where(eq(projectStorageGrants.id, existing.id))
      .returning();
    return toRecord(updated ?? existing);
  }

  const row = {
    id: newId('sg'),
    granterProjectId: input.granterProjectId,
    granteeProjectId: input.granteeProjectId,
    resource,
    isPrefix: input.isPrefix,
    createdBy: input.createdBy,
  };
  const [inserted] = await db.insert(projectStorageGrants).values(row).returning();
  if (!inserted) throw new Error('storage grant insert returned nothing');
  return toRecord(inserted);
}

/**
 * Revoke a grant. ONLY the granter can revoke — the WHERE is scoped by
 * granterProjectId, so a grantee (or any other project) presenting the grant id
 * matches zero rows and gets a NotFoundError. Sets revoked_at (soft), so the
 * unique index row survives for a future re-grant. Idempotent: re-revoking an
 * already-revoked grant still succeeds (the row is still owned by the granter).
 */
export async function revokeGrant(
  granterProjectId: string,
  grantId: string,
): Promise<StorageGrantRecord> {
  await ensureTable();
  const db = getDb();
  const [row] = await db
    .update(projectStorageGrants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(projectStorageGrants.id, grantId),
        eq(projectStorageGrants.granterProjectId, granterProjectId),
      ),
    )
    .returning();
  if (!row) throw new NotFoundError('storage_grant', grantId);
  return toRecord(row);
}

/** Every grant the granter has created (active + revoked), newest first. */
export async function listGrants(granterProjectId: string): Promise<StorageGrantRecord[]> {
  await ensureTable();
  const db = getDb();
  const rows = await db
    .select()
    .from(projectStorageGrants)
    .where(eq(projectStorageGrants.granterProjectId, granterProjectId));
  return rows.map(toRecord).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * THE ENFORCEMENT CHECK. Returns true ONLY if an ACTIVE grant from
 * `granterProjectId` → `granteeProjectId` covers `fileIdOrPath`:
 *   - an exact grant (is_prefix = false) whose `resource` equals the file id, OR
 *   - a prefix grant (is_prefix = true) whose `resource` is a prefix of the
 *     file's OBJECT PATH (`projects/<granterProjectId>/<fileId>`).
 *
 * STRICT-DENY: any error, an unknown file, a self-reference, or no matching
 * active grant → false. Never throws.
 */
export async function isGranted(
  granteeProjectId: string,
  granterProjectId: string,
  fileIdOrPath: string,
): Promise<boolean> {
  try {
    if (!granteeProjectId || !granterProjectId || !fileIdOrPath) return false;
    // A project always "has" its own files through the normal isolated path;
    // grants are strictly cross-project, so a self-reference is not a grant.
    if (granteeProjectId === granterProjectId) return false;

    await ensureTable();
    const db = getDb();

    // Pull every ACTIVE grant from this granter to this grantee. The set is tiny
    // (a project shares a handful of resources), so evaluating prefix matching in
    // code is both correct and cheap — and keeps the SQL a plain equality filter.
    const rows = await db
      .select({
        resource: projectStorageGrants.resource,
        isPrefix: projectStorageGrants.isPrefix,
      })
      .from(projectStorageGrants)
      .where(
        and(
          eq(projectStorageGrants.granterProjectId, granterProjectId),
          eq(projectStorageGrants.granteeProjectId, granteeProjectId),
          isNull(projectStorageGrants.revokedAt),
        ),
      );
    if (rows.length === 0) return false;

    // Resolve the file's real object path so a prefix grant matches the bytes'
    // actual address, not a client-supplied string. getFile is scoped to the
    // GRANTER (the owner) and throws if the file is missing/deleted → deny.
    let objectPath: string | null = null;
    try {
      const file = await getFile(fileIdOrPath, granterProjectId);
      objectPath = file.objectKey;
    } catch {
      // Not a resolvable file id for this granter. An exact-id grant can still
      // match on the raw string below (e.g. grant created before enforcement),
      // but a prefix grant needs a real path — leave objectPath null.
      objectPath = null;
    }

    for (const g of rows) {
      if (!g.isPrefix) {
        // Exact grant: the granted resource must equal the file id exactly.
        if (g.resource === fileIdOrPath) return true;
      } else {
        // Prefix grant: the granted prefix must be a prefix of the file's path.
        // Require a resolved path so a caller can't smuggle an arbitrary string.
        if (objectPath !== null && objectPath.startsWith(g.resource)) return true;
      }
    }
    return false;
  } catch {
    // STRICT-DENY: any unexpected failure denies access.
    return false;
  }
}
