import { randomBytes } from 'node:crypto';

import { newId, NotFoundError, ValidationError } from '@briven/shared';
import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  webhookOutboundDeliveries,
  webhookSubscribers,
  type WebhookOutboundDelivery,
  type WebhookOutboundStatus,
  type WebhookSubscriber,
} from '../db/schema.js';
import { decryptValue, encryptValue } from './project-env.js';

/**
 * Platform → customer outbound webhooks. Each subscriber declares a target
 * URL + which event types they care about (`*` matches everything). When
 * the platform emits an event via `publishEvent`, we fan out to every
 * matching subscriber by inserting a `pending` delivery row. A separate
 * worker (workers/outbound-webhook-dispatcher.ts) drains the queue,
 * POSTs the payload + HMAC signature, and retries failures with
 * exponential backoff up to MAX_ATTEMPTS.
 *
 * The signing scheme matches the inbound webhook surface — customers
 * verify our requests the same way external services verify theirs:
 *   X-Briven-Signature: v1=<hex_hmac_sha256>
 *   X-Briven-Timestamp: <unix-milliseconds>
 *   X-Briven-Event:     <event-type>
 *   X-Briven-Event-Id:  <stable-event-id-for-dedupe>
 *
 * Idempotency: customers should dedupe on `event_id`. Retries reuse the
 * same id; a successful function that processes the same event twice
 * after a network blip must be a no-op on the customer's side.
 */

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const EVENT_TYPE_RE = /^\*$|^[a-z][a-z0-9._-]{0,63}(,[a-z][a-z0-9._-]{0,63})*$/;

/**
 * Canonical event types the platform emits. Subscribers either list
 * specific types (`abuse.report.opened,deploy.failed`) or use `*` to
 * receive everything. New types are added here as they're wired up by
 * the call sites that emit them — keep this list narrow on purpose.
 */
export const KNOWN_EVENT_TYPES = [
  'abuse.report.opened',
  'deploy.succeeded',
  'deploy.failed',
  'tier.changed',
  'project.suspended',
  'project.resumed',
  // briven auth — fan-out of authentication lifecycle events to customer
  // endpoints. Emitted from `apps/api/src/services/auth-audit.ts` when the
  // matching action row lands; subscribers opt in by listing the type or
  // by using `*`.
  'auth.signup',
  'auth.signin',
  'auth.signout',
  'auth.session.revoked',
  'auth.account.linked',
  'auth.account.unlinked',
  'auth.user.deleted',
] as const;
export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

/**
 * The subset of `KNOWN_EVENT_TYPES` produced by briven auth. The dashboard
 * Auth → Webhooks panel exposes only these as toggle checkboxes; the
 * general project webhooks panel surfaces every type.
 */
export const AUTH_EVENT_TYPES = [
  'auth.signup',
  'auth.signin',
  'auth.signout',
  'auth.session.revoked',
  'auth.account.linked',
  'auth.account.unlinked',
  'auth.user.deleted',
] as const;
export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number];

function generateSigningSecret(): string {
  return randomBytes(32).toString('hex');
}

function validateName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new ValidationError(
      'subscriber name must be 1-64 chars: alphanumerics, underscore, hyphen; must start with alphanumeric',
    );
  }
}

function validateTargetUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError('target_url must be a valid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ValidationError('target_url must use http or https');
  }
  // Refuse private-network targets up front. The runtime also has IP
  // deny lists for customer code; we apply the same shape here so a
  // misconfigured subscriber can't be used to scan our internal infra.
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    throw new ValidationError('target_url cannot point at a private network');
  }
}

function validateEventTypes(eventTypes: string): void {
  if (!EVENT_TYPE_RE.test(eventTypes)) {
    throw new ValidationError(
      'event_types must be `*` or a comma-separated list of types (e.g. abuse.report.opened,deploy.failed)',
    );
  }
}

export interface PublicSubscriber {
  id: string;
  projectId: string;
  name: string;
  targetUrl: string;
  eventTypes: string;
  enabled: boolean;
  lastDeliveryAt: Date | null;
  lastDeliveryStatus: WebhookOutboundStatus | null;
  createdAt: Date;
  updatedAt: Date;
}

function redact(row: WebhookSubscriber): PublicSubscriber {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    targetUrl: row.targetUrl,
    eventTypes: row.eventTypes,
    enabled: row.enabled,
    lastDeliveryAt: row.lastDeliveryAt,
    lastDeliveryStatus: row.lastDeliveryStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateSubscriberInput {
  projectId: string;
  name: string;
  targetUrl: string;
  eventTypes?: string;
  enabled?: boolean;
  createdBy: string | null;
}

export async function listSubscribers(projectId: string): Promise<PublicSubscriber[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(webhookSubscribers)
    .where(and(eq(webhookSubscribers.projectId, projectId), isNull(webhookSubscribers.deletedAt)))
    .orderBy(asc(webhookSubscribers.name));
  return rows.map(redact);
}

export async function getSubscriberRaw(
  subscriberId: string,
  projectId: string,
): Promise<WebhookSubscriber> {
  const db = getDb();
  const rows = await db
    .select()
    .from(webhookSubscribers)
    .where(
      and(
        eq(webhookSubscribers.id, subscriberId),
        eq(webhookSubscribers.projectId, projectId),
        isNull(webhookSubscribers.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('webhook_subscriber', subscriberId);
  return row;
}

export async function createSubscriber(
  input: CreateSubscriberInput,
): Promise<{ subscriber: PublicSubscriber; plaintextSecret: string }> {
  validateName(input.name);
  validateTargetUrl(input.targetUrl);
  const eventTypes = input.eventTypes ?? '*';
  validateEventTypes(eventTypes);
  const plaintextSecret = generateSigningSecret();
  const db = getDb();
  const id = newId('whs');
  try {
    const inserted = await db
      .insert(webhookSubscribers)
      .values({
        id,
        projectId: input.projectId,
        name: input.name,
        targetUrl: input.targetUrl,
        eventTypes,
        signingSecretEncrypted: encryptValue(plaintextSecret),
        enabled: input.enabled ?? true,
        createdBy: input.createdBy,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('insert returned no row');
    return { subscriber: redact(row), plaintextSecret };
  } catch (err) {
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      throw new ValidationError(
        `a subscriber named "${input.name}" already exists for this project`,
      );
    }
    throw err;
  }
}

export interface UpdateSubscriberInput {
  name?: string;
  targetUrl?: string;
  eventTypes?: string;
  enabled?: boolean;
}

export async function updateSubscriber(
  subscriberId: string,
  projectId: string,
  patch: UpdateSubscriberInput,
): Promise<PublicSubscriber> {
  const existing = await getSubscriberRaw(subscriberId, projectId);
  const updates: Partial<WebhookSubscriber> = { updatedAt: new Date() };
  if (patch.name !== undefined && patch.name !== existing.name) {
    validateName(patch.name);
    updates.name = patch.name;
  }
  if (patch.targetUrl !== undefined && patch.targetUrl !== existing.targetUrl) {
    validateTargetUrl(patch.targetUrl);
    updates.targetUrl = patch.targetUrl;
  }
  if (patch.eventTypes !== undefined && patch.eventTypes !== existing.eventTypes) {
    validateEventTypes(patch.eventTypes);
    updates.eventTypes = patch.eventTypes;
  }
  if (patch.enabled !== undefined && patch.enabled !== existing.enabled) {
    updates.enabled = patch.enabled;
  }
  const db = getDb();
  const result = await db
    .update(webhookSubscribers)
    .set(updates)
    .where(
      and(eq(webhookSubscribers.id, subscriberId), eq(webhookSubscribers.projectId, projectId)),
    )
    .returning();
  if (!result[0]) throw new NotFoundError('webhook_subscriber', subscriberId);
  return redact(result[0]);
}

export async function rotateSubscriberSecret(
  subscriberId: string,
  projectId: string,
): Promise<{ subscriber: PublicSubscriber; plaintextSecret: string }> {
  await getSubscriberRaw(subscriberId, projectId);
  const plaintextSecret = generateSigningSecret();
  const db = getDb();
  const result = await db
    .update(webhookSubscribers)
    .set({
      signingSecretEncrypted: encryptValue(plaintextSecret),
      updatedAt: new Date(),
    })
    .where(
      and(eq(webhookSubscribers.id, subscriberId), eq(webhookSubscribers.projectId, projectId)),
    )
    .returning();
  if (!result[0]) throw new NotFoundError('webhook_subscriber', subscriberId);
  return { subscriber: redact(result[0]), plaintextSecret };
}

export async function deleteSubscriber(
  subscriberId: string,
  projectId: string,
): Promise<void> {
  const db = getDb();
  const result = await db
    .update(webhookSubscribers)
    .set({ deletedAt: new Date(), enabled: false, updatedAt: new Date() })
    .where(
      and(
        eq(webhookSubscribers.id, subscriberId),
        eq(webhookSubscribers.projectId, projectId),
        isNull(webhookSubscribers.deletedAt),
      ),
    )
    .returning({ id: webhookSubscribers.id });
  if (!result[0]) throw new NotFoundError('webhook_subscriber', subscriberId);
}

export async function listOutboundDeliveries(
  subscriberId: string,
  projectId: string,
  opts: { limit?: number; status?: WebhookOutboundStatus } = {},
): Promise<WebhookOutboundDelivery[]> {
  const db = getDb();
  const whereClauses = [
    eq(webhookOutboundDeliveries.subscriberId, subscriberId),
    eq(webhookOutboundDeliveries.projectId, projectId),
  ];
  if (opts.status) whereClauses.push(eq(webhookOutboundDeliveries.status, opts.status));
  return db
    .select()
    .from(webhookOutboundDeliveries)
    .where(and(...whereClauses))
    .orderBy(desc(webhookOutboundDeliveries.createdAt))
    .limit(opts.limit ?? 100);
}

/**
 * Fan an event out to every matching subscriber on a project. Inserts one
 * `pending` delivery row per match; the dispatcher worker drains them.
 *
 * Idempotency: callers pass a stable `eventId` if they want retries on the
 * caller's side to dedupe on briven's side. Without one, every call
 * inserts fresh rows — fine for fire-and-forget events.
 */
export async function publishEvent(input: {
  projectId: string;
  eventType: KnownEventType;
  payload: Record<string, unknown>;
  eventId?: string;
}): Promise<{ deliveriesQueued: number }> {
  const db = getDb();
  const subscribers = await db
    .select()
    .from(webhookSubscribers)
    .where(
      and(
        eq(webhookSubscribers.projectId, input.projectId),
        eq(webhookSubscribers.enabled, true),
        isNull(webhookSubscribers.deletedAt),
      ),
    );
  const matching = subscribers.filter((s) => matchesEventType(s.eventTypes, input.eventType));
  if (matching.length === 0) return { deliveriesQueued: 0 };

  const eventId = input.eventId ?? newId('wev');
  const now = new Date();
  await db.insert(webhookOutboundDeliveries).values(
    matching.map((s) => ({
      id: newId('whod'),
      subscriberId: s.id,
      projectId: input.projectId,
      eventId,
      eventType: input.eventType,
      payload: input.payload,
      status: 'pending' as const,
      attemptCount: '0',
      nextAttemptAt: now,
    })),
  );
  return { deliveriesQueued: matching.length };
}

export function matchesEventType(filter: string, eventType: string): boolean {
  if (filter === '*') return true;
  return filter.split(',').some((t) => t.trim() === eventType);
}

/**
 * How far forward a claim leases a delivery row. While a dispatcher holds a
 * claimed row (doing the POST), next_attempt_at is pushed this far into the
 * future so an overlapping dispatcher tick won't re-select the same row.
 * recordDeliveryResult sets the authoritative next_attempt_at afterwards; if
 * the dispatcher dies mid-flight the row simply becomes due again after the
 * lease, so no delivery is lost (at-least-once).
 */
const CLAIM_LEASE_MS = 120_000;

/**
 * Dispatcher claim path. Atomically CLAIMS up to `limit` due+pending
 * deliveries: the inner select takes FOR UPDATE SKIP LOCKED so two
 * dispatcher instances (or overlapping ticks) can never grab the same rows
 * — that would POST the same event twice (double-delivery). The claimed rows
 * are leased forward (see CLAIM_LEASE_MS) in the SAME transaction. The caller
 * then does the POST + records the result via recordDeliveryResult.
 */
export async function claimDueDeliveries(
  now: Date,
  limit: number,
): Promise<WebhookOutboundDelivery[]> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: webhookOutboundDeliveries.id })
      .from(webhookOutboundDeliveries)
      .where(
        and(
          eq(webhookOutboundDeliveries.status, 'pending'),
          lte(webhookOutboundDeliveries.nextAttemptAt, now),
        ),
      )
      .orderBy(asc(webhookOutboundDeliveries.nextAttemptAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (due.length === 0) return [];
    const ids = due.map((d) => d.id);
    const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
    return tx
      .update(webhookOutboundDeliveries)
      .set({ nextAttemptAt: leaseUntil })
      .where(inArray(webhookOutboundDeliveries.id, ids))
      .returning();
  });
}

export const MAX_ATTEMPTS = 5;

/**
 * Exponential backoff schedule (in ms) for the next retry attempt
 * AFTER the n-th failure. Attempt 0 retries 30s later, attempt 4
 * (the 5th try) is the terminal state — record it as 'failed' instead
 * of scheduling a 6th. Cap kept short: a webhook that hasn't recovered
 * in ~30 minutes isn't going to.
 */
export function retryDelayMs(attemptCount: number): number {
  const schedule = [30_000, 60_000, 180_000, 600_000, 1_800_000];
  return schedule[Math.min(attemptCount, schedule.length - 1)] ?? 1_800_000;
}

export async function recordDeliveryResult(input: {
  deliveryId: string;
  attemptCount: number;
  statusCode: number | null;
  durationMs: number;
  errorMessage: string | null;
  ok: boolean;
  ranAt: Date;
}): Promise<void> {
  const db = getDb();
  const nextAttempt = input.attemptCount + 1;
  const terminal = input.ok || nextAttempt >= MAX_ATTEMPTS;
  const nextStatus: WebhookOutboundStatus = input.ok
    ? 'ok'
    : terminal
      ? 'failed'
      : 'pending';
  const nextAttemptAt = terminal
    ? input.ranAt
    : new Date(input.ranAt.getTime() + retryDelayMs(input.attemptCount));

  await db
    .update(webhookOutboundDeliveries)
    .set({
      status: nextStatus,
      attemptCount: String(nextAttempt),
      lastAttemptAt: input.ranAt,
      statusCode: input.statusCode == null ? null : String(input.statusCode),
      durationMs: String(input.durationMs),
      errorMessage: input.errorMessage,
      nextAttemptAt,
    })
    .where(eq(webhookOutboundDeliveries.id, input.deliveryId));

  // Roll the subscriber's last_delivery_* summary forward so the
  // dashboard list view stays cheap (no aggregate needed).
  const delivery = await db
    .select({ subscriberId: webhookOutboundDeliveries.subscriberId })
    .from(webhookOutboundDeliveries)
    .where(eq(webhookOutboundDeliveries.id, input.deliveryId))
    .limit(1);
  const subscriberId = delivery[0]?.subscriberId;
  if (subscriberId) {
    await db
      .update(webhookSubscribers)
      .set({
        lastDeliveryAt: input.ranAt,
        lastDeliveryStatus: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(webhookSubscribers.id, subscriberId));
  }
}

/** Decrypt a subscriber's stored signing secret. Reveals plaintext. */
export function decryptSubscriberSecret(row: WebhookSubscriber): string {
  return decryptValue(row.signingSecretEncrypted);
}
