import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { newId, NotFoundError, ValidationError } from '@briven/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  webhookDeliveries,
  webhookEndpoints,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  type WebhookEndpoint,
} from '../db/schema.js';
import { decryptValue, encryptValue } from './project-env.js';

/**
 * Inbound webhook receivers. Each endpoint maps `POST /webhooks/<projectId>/<endpointId>`
 * to a customer-defined function. Authentication is HMAC-SHA256 over
 * `${timestamp}.${rawBody}`, sent in two headers:
 *
 *   X-Briven-Signature: v1=<hex_hmac>
 *   X-Briven-Timestamp: <unix_milliseconds>
 *
 * The timestamp prevents replays — anything outside REPLAY_WINDOW_MS gets
 * rejected even if the signature is otherwise valid. Constant-time
 * comparison via `timingSafeEqual`.
 *
 * Signing secrets are stored AES-256-GCM-encrypted (same KEK + format as
 * project_env_vars). Plaintext is only revealed once, at creation, and
 * on explicit "rotate" — never in list/get responses.
 */

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const FUNCTION_NAME_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]{0,128}$/;
const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const SIGNATURE_RE = /^v1=([0-9a-f]{64})$/i;

function generateSigningSecret(): string {
  // 32 bytes of entropy, hex-encoded → 64 chars. Long enough that a
  // brute-force search is hopeless; short enough to paste into a CI
  // secret-manager UI without scrolling.
  return randomBytes(32).toString('hex');
}

function validateName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new ValidationError(
      'webhook name must be 1-64 chars: alphanumerics, underscore, hyphen; must start with alphanumeric',
    );
  }
}

function validateFunctionName(fn: string): void {
  if (!FUNCTION_NAME_RE.test(fn)) {
    throw new ValidationError('function name must be a valid javascript identifier');
  }
}

export interface CreateWebhookInput {
  projectId: string;
  name: string;
  functionName: string;
  enabled?: boolean;
  createdBy: string | null;
}

export interface CreateWebhookResult {
  endpoint: PublicWebhookEndpoint;
  // Plaintext is returned ONCE at create. Per CLAUDE.md §5.4 the caller
  // must store it immediately — we never log it and the API never
  // surfaces it again.
  plaintextSecret: string;
}

export interface PublicWebhookEndpoint {
  id: string;
  projectId: string;
  name: string;
  functionName: string;
  enabled: boolean;
  lastDeliveryAt: Date | null;
  lastDeliveryStatus: WebhookDeliveryStatus | null;
  createdAt: Date;
  updatedAt: Date;
}

function redact(row: WebhookEndpoint): PublicWebhookEndpoint {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    functionName: row.functionName,
    enabled: row.enabled,
    lastDeliveryAt: row.lastDeliveryAt,
    lastDeliveryStatus: row.lastDeliveryStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listWebhooks(projectId: string): Promise<PublicWebhookEndpoint[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.projectId, projectId), isNull(webhookEndpoints.deletedAt)))
    .orderBy(asc(webhookEndpoints.name));
  return rows.map(redact);
}

export async function getWebhookRaw(
  endpointId: string,
  projectId: string,
): Promise<WebhookEndpoint> {
  const db = getDb();
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.id, endpointId),
        eq(webhookEndpoints.projectId, projectId),
        isNull(webhookEndpoints.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('webhook_endpoint', endpointId);
  return row;
}

export async function getWebhook(
  endpointId: string,
  projectId: string,
): Promise<PublicWebhookEndpoint> {
  return redact(await getWebhookRaw(endpointId, projectId));
}

export async function createWebhook(input: CreateWebhookInput): Promise<CreateWebhookResult> {
  validateName(input.name);
  validateFunctionName(input.functionName);

  const plaintextSecret = generateSigningSecret();
  const db = getDb();
  const id = newId('whe');
  try {
    const inserted = await db
      .insert(webhookEndpoints)
      .values({
        id,
        projectId: input.projectId,
        name: input.name,
        functionName: input.functionName,
        signingSecretEncrypted: encryptValue(plaintextSecret),
        enabled: input.enabled ?? true,
        createdBy: input.createdBy,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('insert returned no row');
    return { endpoint: redact(row), plaintextSecret };
  } catch (err) {
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      throw new ValidationError(
        `a webhook named "${input.name}" already exists for this project`,
      );
    }
    throw err;
  }
}

export interface UpdateWebhookInput {
  name?: string;
  functionName?: string;
  enabled?: boolean;
}

export async function updateWebhook(
  endpointId: string,
  projectId: string,
  patch: UpdateWebhookInput,
): Promise<PublicWebhookEndpoint> {
  const existing = await getWebhookRaw(endpointId, projectId);
  const updates: Partial<WebhookEndpoint> = { updatedAt: new Date() };
  if (patch.name !== undefined && patch.name !== existing.name) {
    validateName(patch.name);
    updates.name = patch.name;
  }
  if (patch.functionName !== undefined && patch.functionName !== existing.functionName) {
    validateFunctionName(patch.functionName);
    updates.functionName = patch.functionName;
  }
  if (patch.enabled !== undefined && patch.enabled !== existing.enabled) {
    updates.enabled = patch.enabled;
  }

  const db = getDb();
  const result = await db
    .update(webhookEndpoints)
    .set(updates)
    .where(
      and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.projectId, projectId)),
    )
    .returning();
  if (!result[0]) throw new NotFoundError('webhook_endpoint', endpointId);
  return redact(result[0]);
}

export async function rotateWebhookSecret(
  endpointId: string,
  projectId: string,
): Promise<{ endpoint: PublicWebhookEndpoint; plaintextSecret: string }> {
  await getWebhookRaw(endpointId, projectId);
  const plaintextSecret = generateSigningSecret();
  const db = getDb();
  const result = await db
    .update(webhookEndpoints)
    .set({
      signingSecretEncrypted: encryptValue(plaintextSecret),
      updatedAt: new Date(),
    })
    .where(
      and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.projectId, projectId)),
    )
    .returning();
  if (!result[0]) throw new NotFoundError('webhook_endpoint', endpointId);
  return { endpoint: redact(result[0]), plaintextSecret };
}

export async function deleteWebhook(endpointId: string, projectId: string): Promise<void> {
  const db = getDb();
  const result = await db
    .update(webhookEndpoints)
    .set({ deletedAt: new Date(), enabled: false, updatedAt: new Date() })
    .where(
      and(
        eq(webhookEndpoints.id, endpointId),
        eq(webhookEndpoints.projectId, projectId),
        isNull(webhookEndpoints.deletedAt),
      ),
    )
    .returning({ id: webhookEndpoints.id });
  if (!result[0]) throw new NotFoundError('webhook_endpoint', endpointId);
}

export async function listDeliveries(
  endpointId: string,
  projectId: string,
  opts: { limit?: number; status?: WebhookDeliveryStatus } = {},
): Promise<WebhookDelivery[]> {
  const db = getDb();
  const whereClauses = [
    eq(webhookDeliveries.endpointId, endpointId),
    eq(webhookDeliveries.projectId, projectId),
  ];
  if (opts.status) whereClauses.push(eq(webhookDeliveries.status, opts.status));
  return db
    .select()
    .from(webhookDeliveries)
    .where(and(...whereClauses))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(opts.limit ?? 100);
}

/**
 * Signature verification. Returns the reason on rejection (so the caller
 * can record it in the delivery log) or null on success.
 *
 * Wire format:
 *   X-Briven-Signature: v1=<64-hex-char hmac_sha256(`${ts}.${rawBody}`)>
 *   X-Briven-Timestamp: <unix-milliseconds>
 */
export type VerifyResult =
  | { ok: true }
  | { ok: false; status: 'rejected_signature' | 'rejected_replay'; reason: string };

export function verifyWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  plaintextSecret: string;
  now: Date;
}): VerifyResult {
  if (!input.signatureHeader || !input.timestampHeader) {
    return {
      ok: false,
      status: 'rejected_signature',
      reason: 'missing X-Briven-Signature or X-Briven-Timestamp header',
    };
  }

  const tsMs = Number(input.timestampHeader);
  if (!Number.isFinite(tsMs) || tsMs <= 0) {
    return {
      ok: false,
      status: 'rejected_signature',
      reason: 'X-Briven-Timestamp not a positive integer',
    };
  }

  const driftMs = Math.abs(input.now.getTime() - tsMs);
  if (driftMs > REPLAY_WINDOW_MS) {
    return {
      ok: false,
      status: 'rejected_replay',
      reason: `timestamp drift ${driftMs}ms exceeds ${REPLAY_WINDOW_MS}ms replay window`,
    };
  }

  const match = SIGNATURE_RE.exec(input.signatureHeader);
  if (!match) {
    return {
      ok: false,
      status: 'rejected_signature',
      reason: 'X-Briven-Signature must be `v1=<64-hex-chars>`',
    };
  }
  const claimed = match[1]!;

  const expected = createHmac('sha256', input.plaintextSecret)
    .update(`${input.timestampHeader}.${input.rawBody}`)
    .digest('hex');

  const a = Buffer.from(claimed, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) {
    return { ok: false, status: 'rejected_signature', reason: 'signature length mismatch' };
  }
  if (!timingSafeEqual(a, b)) {
    return { ok: false, status: 'rejected_signature', reason: 'signature mismatch' };
  }

  return { ok: true };
}

/** Decrypt an endpoint's stored signing secret. Reveals plaintext. */
export function decryptEndpointSecret(row: WebhookEndpoint): string {
  return decryptValue(row.signingSecretEncrypted);
}

export interface RecordDeliveryInput {
  endpointId: string;
  projectId: string;
  status: WebhookDeliveryStatus;
  sourceIpHash: string | null;
  functionName: string | null;
  durationMs: number | null;
  errorMessage: string | null;
}

export async function recordDelivery(input: RecordDeliveryInput): Promise<void> {
  const db = getDb();
  await db.insert(webhookDeliveries).values({
    id: newId('whd'),
    endpointId: input.endpointId,
    projectId: input.projectId,
    status: input.status,
    sourceIpHash: input.sourceIpHash,
    functionName: input.functionName,
    durationMs: input.durationMs == null ? null : String(input.durationMs),
    errorMessage: input.errorMessage,
  });
  // Update the endpoint summary in the same transaction-equivalent — the
  // dashboard "last delivery" indicator reads from this denormalised
  // column instead of joining + ordering on every list request.
  await db
    .update(webhookEndpoints)
    .set({
      lastDeliveryAt: new Date(),
      lastDeliveryStatus: input.status,
      updatedAt: new Date(),
    })
    .where(eq(webhookEndpoints.id, input.endpointId));
}
