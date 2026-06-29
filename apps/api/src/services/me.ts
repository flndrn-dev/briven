import { createHash, timingSafeEqual } from 'node:crypto';

import { NotFoundError, ValidationError } from '@briven/shared';
import { and, desc, eq, isNotNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { accounts, sessions, users } from '../db/schema.js';
import { lookupIp } from '../lib/geoip.js';
import { decryptValue, encryptValue } from './project-env.js';
import { getDefaultOrgForUser } from './orgs.js';

export interface ProfilePatch {
  name?: string | null;
  legalName?: string | null;
  companyName?: string | null;
  companyRegistrationNumber?: string | null;
  vatId?: string | null;
  vatVerifiedAt?: Date | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressPostalCode?: string | null;
  addressRegion?: string | null;
  addressCountry?: string | null;
  dateOfBirth?: string | null;
  countryOfBirth?: string | null;
  timezone?: string | null;
}

/**
 * Does this user have a usable account password? True only when a Better
 * Auth credential account row exists with a non-null password hash —
 * passwordless (magic-link / OAuth-only) users return false. Used to (a)
 * surface `hasPassword` on /v1/me so the dashboard can offer "set a
 * password", and (b) route POST /v1/me/password to setPassword vs
 * changePassword. The destructive-action step-up (POST /v1/me/step-up)
 * re-checks this same password, so a passwordless user must set one first.
 */
export async function hasPasswordCredential(userId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, 'credential'),
        isNotNull(accounts.password),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function getCurrentVat(
  userId: string,
): Promise<{ vatId: string | null; vatVerifiedAt: Date | null }> {
  const db = getDb();
  const [row] = await db
    .select({ vatId: users.vatId, vatVerifiedAt: users.vatVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? { vatId: null, vatVerifiedAt: null };
}

/**
 * Fetch the KYC / profile block for the signed-in user.
 * Returns what's persisted in `users` plus the most recent session's
 * `nearBy` city (resolved from the IP via GeoIP). The raw IP is NEVER
 * surfaced — CLAUDE.md §5.1 forbids IP addresses in any public-facing
 * response, including the account holder's own.
 */
export async function getProfile(userId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      name: users.name,
      image: users.image,
      isAdmin: users.isAdmin,
      suspendedAt: users.suspendedAt,
      legalName: users.legalName,
      companyName: users.companyName,
      companyRegistrationNumber: users.companyRegistrationNumber,
      vatId: users.vatId,
      vatVerifiedAt: users.vatVerifiedAt,
      addressLine1: users.addressLine1,
      addressLine2: users.addressLine2,
      addressCity: users.addressCity,
      addressPostalCode: users.addressPostalCode,
      addressRegion: users.addressRegion,
      addressCountry: users.addressCountry,
      dateOfBirth: users.dateOfBirth,
      countryOfBirth: users.countryOfBirth,
      timezone: users.timezone,
      createdAt: users.createdAt,
      deleteSecretHash: users.deleteSecretHash,
      deleteSecretSetAt: users.deleteSecretSetAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // Structured so the error middleware emits a clean 404 (→ the client
  // redirects to sign-in) instead of an opaque 500.
  if (!row) throw new NotFoundError('user', userId);

  // Split the delete-secret status off the row so the hash never leaks
  // into the returned profile — only the boolean + set-at timestamp do.
  const { deleteSecretHash, deleteSecretSetAt, ...profileRow } = row;

  const [last] = await db
    .select({
      createdAt: sessions.createdAt,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt))
    .limit(1);

  const nearBy = last ? await lookupIp(last.ipAddress) : null;

  // Default org is resolved once per /v1/me call. It's always the user's
  // personal org (auto-created by migration 0010). Web uses this as the
  // implicit org-context for every billing + project route — URLs stay
  // org-less until Phase 3 adds a switcher.
  const defaultOrg = await getDefaultOrgForUser(userId);

  // Whether the user can satisfy the destructive-action password step-up.
  const hasPassword = await hasPasswordCredential(userId);

  return {
    ...profileRow,
    hasPassword,
    hasDeleteSecret: Boolean(deleteSecretHash),
    deleteSecretSetAt: deleteSecretSetAt ? deleteSecretSetAt.toISOString() : null,
    defaultOrgId: defaultOrg.id,
    lastSignIn: last
      ? {
          at: last.createdAt,
          ipAddress: last.ipAddress,
          userAgent: last.userAgent,
          nearBy,
        }
      : null,
  };
}

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function setAvatar(userId: string, dataUri: string | null): Promise<void> {
  const db = getDb();
  await db.update(users).set({ image: dataUri, updatedAt: new Date() }).where(eq(users.id, userId));
}

/* ─── delete secret ──────────────────────────────────────────────────
 *
 * A user-chosen "delete secret" that gates project deletion. Mirrors the
 * SDK-key pattern (services/auth-sdk-keys.ts): the sha-256 hex
 * `delete_secret_hash` is the ONLY verification mechanism, while the
 * AES-256-GCM `delete_secret_enc` ciphertext (BRIVEN_ENCRYPTION_KEY KEK via
 * services/project-env.ts) exists solely so the owner can reveal/copy the
 * secret again through the authenticated + audited reveal path. The
 * plaintext is NEVER logged.
 */

const DELETE_SECRET_MIN_LENGTH = 12;
const DELETE_SECRET_RULE_MESSAGE =
  'secret must be at least 12 characters and include a capital letter, a number, and a special character';

/**
 * Enforce the delete-secret complexity policy. Throws ValidationError with a
 * single human-readable message on failure (the route maps it to a 400).
 */
function validateDeleteSecret(secret: string): void {
  const longEnough = secret.length >= DELETE_SECRET_MIN_LENGTH;
  const hasUpper = /[A-Z]/.test(secret);
  const hasDigit = /[0-9]/.test(secret);
  const hasSpecial = /[^A-Za-z0-9]/.test(secret);
  if (!longEnough || !hasUpper || !hasDigit || !hasSpecial) {
    throw new ValidationError(DELETE_SECRET_RULE_MESSAGE);
  }
}

/**
 * Thrown by setDeleteSecret when a secret already exists. The route maps it
 * to a 409 so the dashboard can prompt the user to reset first.
 */
export class DeleteSecretExistsError extends Error {
  readonly code = 'delete_secret_exists' as const;
  constructor(message = 'a delete secret is already set — reset it first') {
    super(message);
    this.name = 'DeleteSecretExistsError';
  }
}

export async function getDeleteSecretStatus(
  userId: string,
): Promise<{ hasSecret: boolean; setAt: Date | null }> {
  const db = getDb();
  const [row] = await db
    .select({
      hash: users.deleteSecretHash,
      setAt: users.deleteSecretSetAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { hasSecret: Boolean(row?.hash), setAt: row?.setAt ?? null };
}

export async function setDeleteSecret(
  userId: string,
  secret: string,
): Promise<{ setAt: Date }> {
  const existing = await getDeleteSecretStatus(userId);
  if (existing.hasSecret) throw new DeleteSecretExistsError();
  validateDeleteSecret(secret);

  const hash = createHash('sha256').update(secret).digest('hex');
  const enc = encryptValue(secret);
  const setAt = new Date();

  const db = getDb();
  await db
    .update(users)
    .set({
      deleteSecretHash: hash,
      deleteSecretEnc: enc,
      deleteSecretSetAt: setAt,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  return { setAt };
}

/**
 * Decrypt and return the user's delete secret so they can copy it again.
 * Throws NotFoundError when no secret (no ciphertext) is set. The plaintext
 * is NEVER logged here — the caller audits the reveal without the value.
 */
export async function revealDeleteSecret(userId: string): Promise<{ secret: string }> {
  const db = getDb();
  const [row] = await db
    .select({ enc: users.deleteSecretEnc })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.enc) throw new NotFoundError('delete_secret', userId);
  return { secret: decryptValue(row.enc) };
}

/**
 * Verify a candidate secret against the stored sha-256 hash in constant
 * time. Returns false when no secret is set or the input doesn't match.
 */
export async function verifyDeleteSecret(userId: string, secret: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ hash: users.deleteSecretHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.hash) return false;

  const candidate = createHash('sha256').update(secret).digest();
  const stored = Buffer.from(row.hash, 'hex');
  // Guard length before timingSafeEqual — it throws on unequal-length
  // buffers. Both are 32-byte sha-256 digests, but a malformed stored
  // value would otherwise crash instead of returning a clean false.
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export async function resetDeleteSecret(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({
      deleteSecretHash: null,
      deleteSecretEnc: null,
      deleteSecretSetAt: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}
