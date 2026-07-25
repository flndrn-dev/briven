/**
 * Service badges — project-scoped agent/machine passes.
 *
 * One badge opens exactly one product wall inside one project:
 *   db   → Doltgres (studio / query / tables) via bearer `sb_db_…`
 *   s3   → this project's MinIO/S3 bucket (storage key under the hood)
 *   auth → SuperTokens-style M2M client_credentials (briven-engine)
 *   pay  → reserved (not mintable yet)
 *
 * Secrets are returned once at create. Revoke is idempotent.
 */

import { createHash, randomBytes } from 'node:crypto';

import { newId, NotFoundError, ValidationError } from '@briven/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { env } from '../env.js';
import { getDb } from '../db/client.js';
import {
  serviceBadgeProduct,
  serviceBadgeRole,
  serviceBadges,
  type ServiceBadgeProduct,
  type ServiceBadgeRole,
} from '../db/schema.js';
import { createM2mClient, revokeM2mClient } from './auth-core/m2m.js';
import { createStorageKey, revokeStorageKey } from './storage-keys.js';

const KEY_ENTROPY_BYTES = 32;
const NAME_MIN = 1;
const NAME_MAX = 80;

/** Plaintext prefix per product — greppable if leaked. */
export const SERVICE_BADGE_PREFIX: Record<ServiceBadgeProduct, string> = {
  db: 'sb_db_',
  s3: 'sb_s3_',
  auth: 'sb_auth_',
  pay: 'sb_pay_',
};

const MINTABLE: readonly ServiceBadgeProduct[] = ['db', 's3', 'auth'];

export function isServiceBadgeProduct(v: string): v is ServiceBadgeProduct {
  return (serviceBadgeProduct as readonly string[]).includes(v);
}

export function isMintableServiceBadgeProduct(v: string): v is 'db' | 's3' | 'auth' {
  return (MINTABLE as readonly string[]).includes(v);
}

export function isServiceBadgeRole(v: string): v is ServiceBadgeRole {
  return (serviceBadgeRole as readonly string[]).includes(v);
}

/** True when a bearer looks like any service-badge secret. */
export function looksLikeServiceBadge(token: string): boolean {
  return (
    token.startsWith(SERVICE_BADGE_PREFIX.db) ||
    token.startsWith(SERVICE_BADGE_PREFIX.s3) ||
    token.startsWith(SERVICE_BADGE_PREFIX.auth) ||
    token.startsWith(SERVICE_BADGE_PREFIX.pay)
  );
}

function hashBearer(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await getDb().execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "service_badges" (
        "id" text PRIMARY KEY NOT NULL,
        "project_id" text NOT NULL,
        "product" text NOT NULL,
        "name" text NOT NULL,
        "role" text DEFAULT 'developer' NOT NULL,
        "prefix" text NOT NULL,
        "suffix" varchar(4) NOT NULL,
        "hash" text,
        "storage_key_id" text,
        "m2m_client_id" text,
        "created_by" text,
        "last_used_at" timestamp with time zone,
        "expires_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "revoked_at" timestamp with time zone
      )`),
  );
  await getDb().execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "service_badges_hash_idx" ON "service_badges" ("hash")`,
    ),
  );
  await getDb().execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "service_badges_project_product_idx" ON "service_badges" ("project_id","product")`,
    ),
  );
  tableReady = true;
}

export interface MaskedServiceBadge {
  id: string;
  product: ServiceBadgeProduct;
  name: string;
  role: ServiceBadgeRole;
  prefix: string;
  suffix: string;
  /** product=auth: M2M client id (public half of the machine pair). */
  m2mClientId: string | null;
  /** product=s3: MinIO access key id. */
  storageAccessKeyId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface CreatedServiceBadge {
  badge: MaskedServiceBadge;
  /**
   * product=db: full bearer secret (sb_db_…).
   * product=s3 / auth: may be null; product-specific secrets below.
   */
  plaintext: string | null;
  /** product=s3 only — MinIO credentials for this project's bucket. */
  s3?: {
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  };
  /** product=auth only — SuperTokens-style M2M client credentials. */
  auth?: {
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
  };
}

function iso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

function toMasked(row: {
  id: string;
  product: ServiceBadgeProduct;
  name: string;
  role: ServiceBadgeRole;
  prefix: string;
  suffix: string;
  m2mClientId: string | null;
  storageKeyId: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  storageAccessKeyId?: string | null;
}): MaskedServiceBadge {
  return {
    id: row.id,
    product: row.product,
    name: row.name,
    role: row.role,
    prefix: row.prefix,
    suffix: row.suffix,
    m2mClientId: row.m2mClientId,
    storageAccessKeyId: row.storageAccessKeyId ?? null,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    lastUsedAt: iso(row.lastUsedAt),
    expiresAt: iso(row.expiresAt),
    revokedAt: iso(row.revokedAt),
  };
}

export async function listServiceBadges(
  projectId: string,
  product?: ServiceBadgeProduct,
): Promise<MaskedServiceBadge[]> {
  await ensureTable();
  const db = getDb();
  const rows = await db
    .select()
    .from(serviceBadges)
    .where(
      product
        ? and(eq(serviceBadges.projectId, projectId), eq(serviceBadges.product, product))
        : eq(serviceBadges.projectId, projectId),
    )
    .orderBy(desc(serviceBadges.createdAt));

  return rows.map((r) =>
    toMasked({
      ...r,
      storageAccessKeyId: null,
    }),
  );
}

export async function createServiceBadge(input: {
  projectId: string;
  product: ServiceBadgeProduct;
  name: string;
  role?: ServiceBadgeRole;
  createdBy: string | null;
  expiresAt?: Date;
}): Promise<CreatedServiceBadge> {
  await ensureTable();
  const name = input.name.trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    throw new ValidationError(`name must be ${NAME_MIN}-${NAME_MAX} chars`, { name });
  }
  if (!isMintableServiceBadgeProduct(input.product)) {
    throw new ValidationError(
      input.product === 'pay'
        ? 'Briven Pay badges are not available yet'
        : `product must be one of ${MINTABLE.join(' | ')}`,
      { product: input.product },
    );
  }
  const role: ServiceBadgeRole =
    input.role && isServiceBadgeRole(input.role) ? input.role : 'developer';
  if (!isServiceBadgeRole(role)) {
    throw new ValidationError(`role must be one of ${serviceBadgeRole.join(' | ')}`, { role });
  }

  const prefix = SERVICE_BADGE_PREFIX[input.product];
  const id = newId('sb');

  if (input.product === 'db') {
    const raw = randomBytes(KEY_ENTROPY_BYTES).toString('base64url');
    const plaintext = `${prefix}${raw}`;
    const hash = hashBearer(plaintext);
    const suffix = plaintext.slice(-4);

    const [record] = await getDb()
      .insert(serviceBadges)
      .values({
        id,
        projectId: input.projectId,
        product: 'db',
        name,
        role,
        prefix,
        suffix,
        hash,
        createdBy: input.createdBy,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    if (!record) throw new Error('service_badges insert returned no row');

    return {
      badge: toMasked({ ...record, storageAccessKeyId: null }),
      plaintext,
    };
  }

  if (input.product === 's3') {
    const publicEndpoint =
      env.BRIVEN_MINIO_PUBLIC_ENDPOINT ?? env.BRIVEN_MINIO_ENDPOINT ?? '';
    const created = await createStorageKey({
      projectId: input.projectId,
      name,
      createdBy: input.createdBy,
      publicEndpoint,
    });
    // Registry row links to the storage key; secret is MinIO's, not a sb_s3_ bearer.
    const [record] = await getDb()
      .insert(serviceBadges)
      .values({
        id,
        projectId: input.projectId,
        product: 's3',
        name,
        role,
        prefix,
        suffix: created.record.suffix,
        hash: null,
        storageKeyId: created.record.id,
        createdBy: input.createdBy,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    if (!record) throw new Error('service_badges insert returned no row');

    return {
      badge: toMasked({
        ...record,
        storageAccessKeyId: created.accessKey,
      }),
      plaintext: null,
      s3: {
        endpoint: created.endpoint,
        bucket: created.bucket,
        accessKey: created.accessKey,
        secretKey: created.secretKey,
      },
    };
  }

  // product === 'auth' — SuperTokens-style M2M under the hood
  const m2m = await createM2mClient({
    projectId: input.projectId,
    name,
    role,
    createdBy: input.createdBy,
  });
  const [record] = await getDb()
    .insert(serviceBadges)
    .values({
      id,
      projectId: input.projectId,
      product: 'auth',
      name,
      role,
      prefix,
      suffix: m2m.client.secretSuffix,
      hash: null,
      m2mClientId: m2m.client.clientId,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  if (!record) throw new Error('service_badges insert returned no row');

  const apiBase = (env.BRIVEN_API_ORIGIN ?? '').replace(/\/$/, '');
  const tokenUrl = apiBase
    ? `${apiBase}/v1/auth-core/oauth/token`
    : '/v1/auth-core/oauth/token';

  return {
    badge: toMasked({ ...record, storageAccessKeyId: null }),
    plaintext: null,
    auth: {
      clientId: m2m.client.clientId,
      clientSecret: m2m.clientSecret,
      tokenUrl,
    },
  };
}

export async function revokeServiceBadge(
  projectId: string,
  badgeId: string,
): Promise<void> {
  await ensureTable();
  const db = getDb();
  const [row] = await db
    .select()
    .from(serviceBadges)
    .where(and(eq(serviceBadges.id, badgeId), eq(serviceBadges.projectId, projectId)))
    .limit(1);
  if (!row) throw new NotFoundError('service_badge', badgeId);
  if (row.revokedAt) return; // idempotent

  // Tear down the product credential first, then stamp the registry.
  if (row.product === 's3' && row.storageKeyId) {
    try {
      await revokeStorageKey(projectId, row.storageKeyId);
    } catch {
      // storage key may already be gone — still revoke the badge row
    }
  }
  if (row.product === 'auth' && row.m2mClientId) {
    try {
      await revokeM2mClient(projectId, row.m2mClientId);
    } catch {
      // m2m client may already be gone
    }
  }

  await db
    .update(serviceBadges)
    .set({ revokedAt: new Date() })
    .where(eq(serviceBadges.id, badgeId));
}

/**
 * Resolve a Doltgres (product=db) bearer secret.
 * Returns null if invalid, wrong product, revoked, or expired.
 */
export async function resolveDbServiceBadge(plaintext: string): Promise<{
  badgeId: string;
  projectId: string;
  role: ServiceBadgeRole;
  product: 'db';
} | null> {
  if (!plaintext.startsWith(SERVICE_BADGE_PREFIX.db)) return null;
  await ensureTable();
  const hash = hashBearer(plaintext);
  const db = getDb();
  const [row] = await db
    .select()
    .from(serviceBadges)
    .where(
      and(
        eq(serviceBadges.hash, hash),
        eq(serviceBadges.product, 'db'),
        isNull(serviceBadges.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

  await db
    .update(serviceBadges)
    .set({ lastUsedAt: new Date() })
    .where(eq(serviceBadges.id, row.id));

  return {
    badgeId: row.id,
    projectId: row.projectId,
    role: row.role,
    product: 'db',
  };
}

/**
 * Product wall check: a service-badge actor may only call routes for its product.
 * Session / brk_ / CLI / M2M JWT actors have no product lock (full project tools).
 */
export function serviceBadgeAllowedOnRoute(
  badgeProduct: ServiceBadgeProduct | null | undefined,
  routeProduct: ServiceBadgeProduct | 'any',
): boolean {
  if (!badgeProduct) return true; // not a service-badge actor
  if (routeProduct === 'any') return false; // badge never opens "everything"
  return badgeProduct === routeProduct;
}
