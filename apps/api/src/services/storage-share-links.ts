import { randomBytes } from 'node:crypto';

import { newId, NotFoundError } from '@briven/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { projectStorageShareLinks, type ProjectStorageShareLink } from '../db/schema.js';
import { env } from '../env.js';
import { getFile } from './storage.js';

/**
 * Tokenized public share-links for storage files (M5, public-link half).
 *
 * This is the SECOND sanctioned way to share a file — complementing the
 * project→project grants (`storage-grants.ts`). A file OWNER mints a signed
 * PUBLIC link: a URL carrying a cryptographically-random token that ANYONE can
 * open for a LIMITED TIME, with NO project/auth needed — and can revoke at will.
 *
 * SECURITY MODEL (strict-deny by construction):
 *   - `resolveShareLink(token)` — THE ENFORCEMENT — returns `{ projectId, fileId }`
 *     ONLY when an ACTIVE link matches: `token` exact-equals AND `revoked_at IS
 *     NULL` AND `expires_at > now()`. Any miss / expired / revoked / error → null.
 *     It never throws. This is the one function the public no-auth route trusts.
 *   - The token is a ≥32-byte URL-safe (base64url) random string from node
 *     crypto (`randomBytes`). It is the ONLY bearer credential and is NEVER
 *     logged (the MCP tools audit file_id + expiry, never the token).
 *   - A link exposes exactly ONE owned file. `createShareLink` resolves the file
 *     through the owner-scoped `getFile(fileId, projectId)` and rejects anything
 *     the project does not own / that is missing / deleted.
 *   - Only the owner may revoke: `revokeShareLink` scopes its WHERE by projectId,
 *     so project A can never touch project B's link (matches zero rows → deny).
 *   - A link works even for a file that is NOT marked public — that is the whole
 *     point of a private, time-limited link — but ONLY via a valid token.
 *
 * The control-plane table is created idempotently on first use (CREATE TABLE IF
 * NOT EXISTS — same pattern as storage-grants) so the code is safe even before
 * migration 0051 has been applied.
 */

/** Token entropy — 32 bytes → ~43 URL-safe base64url chars. */
const TOKEN_BYTES = 32;

/** Expiry clamps (seconds): min 60s, default 24h, max 30 days. */
const MIN_EXPIRES_SEC = 60;
const DEFAULT_EXPIRES_SEC = 24 * 60 * 60;
const MAX_EXPIRES_SEC = 30 * 24 * 60 * 60;

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const db = getDb();
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS "project_storage_share_links" (
        "id" text PRIMARY KEY NOT NULL,
        "project_id" text NOT NULL,
        "file_id" text NOT NULL,
        "token" text NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "created_by" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "revoked_at" timestamp with time zone
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_storage_share_links_token_idx" ON "project_storage_share_links" ("token")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "project_storage_share_links_project_idx" ON "project_storage_share_links" ("project_id")`,
    ),
  );
  tableReady = true;
}

export interface ShareLinkRecord {
  id: string;
  projectId: string;
  fileId: string;
  /** The bearer token — included so a fresh create can return its URL. Callers
   *  that LIST links may choose to omit it; `toRecord` keeps it for symmetry. */
  token: string;
  url: string;
  expiresAt: string;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** `https://media.<domain>/link/<token>` — built from env like other code does. */
function shareLinkUrl(token: string): string {
  const domain = env.BRIVEN_DOMAIN ?? 'briven.tech';
  return `https://media.${domain}/link/${token}`;
}

function toRecord(r: ProjectStorageShareLink): ShareLinkRecord {
  const iso = (d: Date | null): string | null =>
    d ? (d instanceof Date ? d : new Date(d)).toISOString() : null;
  return {
    id: r.id,
    projectId: r.projectId,
    fileId: r.fileId,
    token: r.token,
    url: shareLinkUrl(r.token),
    expiresAt: iso(r.expiresAt) ?? new Date().toISOString(),
    createdBy: r.createdBy ?? null,
    createdAt: iso(r.createdAt) ?? new Date().toISOString(),
    revokedAt: iso(r.revokedAt),
  };
}

/** Clamp a requested expiry (seconds) into [min, max], defaulting when unset. */
export function clampExpiresInSeconds(requested: number | null | undefined): number {
  if (requested === null || requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_EXPIRES_SEC;
  }
  const n = Math.floor(requested);
  if (n < MIN_EXPIRES_SEC) return MIN_EXPIRES_SEC;
  if (n > MAX_EXPIRES_SEC) return MAX_EXPIRES_SEC;
  return n;
}

export interface CreateShareLinkInput {
  projectId: string;
  fileId: string;
  /** Requested lifetime in seconds. Clamped to [60s, 30d]; defaults to 24h. */
  expiresInSeconds?: number | null;
  createdBy: string | null;
}

export interface CreateShareLinkResult {
  id: string;
  token: string;
  url: string;
  expiresAt: string;
}

/**
 * Mint a public share-link for one of the OWNER's files. Validates the file
 * belongs to `projectId` (owner-scoped `getFile`, which throws NotFoundError if
 * missing/deleted/not owned), clamps the expiry, generates a random token, and
 * inserts. Returns `{ id, token, url, expiresAt }`. Every call mints a fresh
 * link — links are cheap and independently revocable, so we never dedupe.
 */
export async function createShareLink(input: CreateShareLinkInput): Promise<CreateShareLinkResult> {
  // Owner-scoped resolution: throws NotFoundError if the file isn't this
  // project's live file. This is the only way a projectId can name a fileId.
  await getFile(input.fileId, input.projectId);

  await ensureTable();
  const db = getDb();

  const expiresInSeconds = clampExpiresInSeconds(input.expiresInSeconds);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  const row = {
    id: newId('sl'),
    projectId: input.projectId,
    fileId: input.fileId,
    token,
    expiresAt,
    createdBy: input.createdBy,
  };
  const [inserted] = await db.insert(projectStorageShareLinks).values(row).returning();
  if (!inserted) throw new Error('storage share-link insert returned nothing');
  const rec = toRecord(inserted);
  return { id: rec.id, token: rec.token, url: rec.url, expiresAt: rec.expiresAt };
}

/**
 * Revoke a share-link. ONLY the owner can revoke — the WHERE is scoped by
 * projectId, so any other project presenting the link id matches zero rows and
 * gets a NotFoundError. Sets revoked_at (soft). Idempotent: re-revoking an
 * already-revoked link still succeeds (the row is still owned by the project).
 */
export async function revokeShareLink(
  projectId: string,
  linkId: string,
): Promise<ShareLinkRecord> {
  await ensureTable();
  const db = getDb();
  const [row] = await db
    .update(projectStorageShareLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(projectStorageShareLinks.id, linkId),
        eq(projectStorageShareLinks.projectId, projectId),
      ),
    )
    .returning();
  if (!row) throw new NotFoundError('storage_share_link', linkId);
  return toRecord(row);
}

/** Every share-link the project owns (active + revoked + expired), newest first. */
export async function listShareLinks(projectId: string): Promise<ShareLinkRecord[]> {
  await ensureTable();
  const db = getDb();
  const rows = await db
    .select()
    .from(projectStorageShareLinks)
    .where(eq(projectStorageShareLinks.projectId, projectId));
  return rows.map(toRecord).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * THE ENFORCEMENT. Resolve a bearer token to the file it grants — but ONLY when
 * an ACTIVE link matches: exact `token` AND `revoked_at IS NULL` AND
 * `expires_at > now()`. Any miss / expired / revoked / bad input / error → null.
 * Never throws. This is the sole check the public no-auth `/link/:token` route
 * relies on, so it fails CLOSED on everything.
 */
export async function resolveShareLink(
  token: string,
): Promise<{ projectId: string; fileId: string } | null> {
  try {
    if (typeof token !== 'string' || token.length === 0) return null;

    await ensureTable();
    const db = getDb();

    // The three predicates ARE the security contract, enforced in SQL:
    //   token exact-equals  ·  revoked_at IS NULL  ·  expires_at > now()
    const [row] = await db
      .select({
        projectId: projectStorageShareLinks.projectId,
        fileId: projectStorageShareLinks.fileId,
      })
      .from(projectStorageShareLinks)
      .where(
        and(
          eq(projectStorageShareLinks.token, token),
          isNull(projectStorageShareLinks.revokedAt),
          gt(projectStorageShareLinks.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!row || !row.projectId || !row.fileId) return null;
    return { projectId: row.projectId, fileId: row.fileId };
  } catch {
    // STRICT-DENY: any unexpected failure denies access.
    return null;
  }
}
