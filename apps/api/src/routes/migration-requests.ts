import { ValidationError } from '@briven/shared';
import { Hono } from 'hono';

import {
  sendMigrationRequestCustomerConfirmation,
  sendMigrationRequestOperatorAlert,
} from '../lib/email.js';
import { log } from '../lib/logger.js';
import { ipKey, rateLimit } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/session.js';
import { audit, hashIp, listAuditForMigrationRequest } from '../services/audit.js';
import { trackMarketingEvent } from '../services/marketing-events.js';
import {
  createMigrationRequest,
  deleteMigrationRequestForUser,
  getMigrationRequest,
  listMigrationRequestsForUser,
} from '../services/migration-requests.js';
import type { AppEnv } from '../types/app-env.js';

/**
 * Customer-facing migration request intake. Submitted from the dashboard
 * wizard at /dashboard/projects/new/migrate. Each request is triaged by
 * an operator via /dashboard/admin/migrations during beta; the planned
 * adapter pipeline will eventually process supported sources without an
 * operator in the loop.
 */
export const migrationRequestsRouter = new Hono<AppEnv>();

migrationRequestsRouter.use('/v1/migration-requests', requireAuth());
migrationRequestsRouter.use('/v1/migration-requests/*', requireAuth());

migrationRequestsRouter.get('/v1/migration-requests', async (c) => {
  const user = c.get('user')!;
  const rows = await listMigrationRequestsForUser(user.id, { limit: 50 });
  return c.json({ requests: rows.map(serialize) });
});

/**
 * Customer-facing timeline for a single migration request. Returns
 * the request itself plus the chronological list of audit events
 * scoped to that request. Auth-gated by /v1/migration-requests/* and
 * ownership-gated below (returns 404 when the request belongs to a
 * different user — same shape as "doesn't exist" so the endpoint
 * doesn't leak the existence of other users' requests).
 */
migrationRequestsRouter.get('/v1/migration-requests/:id', async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  let request;
  try {
    request = await getMigrationRequest(id);
  } catch {
    return c.json({ code: 'not_found' }, 404);
  }
  if (request.userId !== user.id) {
    return c.json({ code: 'not_found' }, 404);
  }
  const timeline = await listAuditForMigrationRequest(id, 100);
  return c.json({
    request: serialize(request),
    timeline: timeline.map((t) => ({
      id: t.id,
      action: t.action,
      createdAt: t.createdAt.toISOString(),
      // Filter the metadata for what's safe to surface to the customer:
      // never the operator's user id, never the ip hash, never internal
      // field names. Only the high-level signal of what changed.
      metadata: {
        source: typeof t.metadata?.source === 'string' ? t.metadata.source : null,
        statusChanged:
          typeof t.metadata?.statusChanged === 'boolean'
            ? t.metadata.statusChanged
            : t.action === 'migration_request.status_change'
              ? true
              : null,
        newStatus:
          typeof t.metadata?.newStatus === 'string'
            ? t.metadata.newStatus
            : null,
        previousStatus:
          typeof t.metadata?.previousStatus === 'string'
            ? t.metadata.previousStatus
            : null,
        messageIncluded:
          typeof t.metadata?.messageIncluded === 'boolean'
            ? t.metadata.messageIncluded
            : null,
        linkedUserId: typeof t.metadata?.linkedUserId === 'string',
      },
    })),
  });
});

/**
 * Hard-delete a migration request the caller owns. 404 also covers
 * "not yours" so we don't leak the existence of other users' requests.
 */
migrationRequestsRouter.delete('/v1/migration-requests/:id', async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const ok = await deleteMigrationRequestForUser(id, user.id);
  if (!ok) return c.json({ code: 'not_found' }, 404);
  await audit({
    actorId: user.id,
    projectId: null,
    action: 'migration_request.delete',
    ipHash: hashIpFromReq(c.req.raw.headers.get('x-forwarded-for')),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { requestId: id },
  });
  return c.json({ ok: true });
});

migrationRequestsRouter.post('/v1/migration-requests', async (c) => {
  const user = c.get('user')!;
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return c.json({ code: 'validation_failed', message: 'JSON body required' }, 400);
  }
  try {
    const request = await createMigrationRequest({
      userId: user.id,
      orgId: typeof body.orgId === 'string' ? body.orgId : null,
      source: String(body.source ?? ''),
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : null,
      sourceNotes: typeof body.sourceNotes === 'string' ? body.sourceNotes : '',
      estimatedTables: toOptionalInt(body.estimatedTables),
      estimatedRows: toOptionalBigint(body.estimatedRows),
      estimatedFunctions: toOptionalInt(body.estimatedFunctions),
      urgency: typeof body.urgency === 'string' ? body.urgency : 'exploring',
      // Default the contact email to the signed-in user's address; the
      // wizard sends this explicitly but we accept an empty/missing value
      // and fall back so a curious user hitting the endpoint with curl
      // still produces a usable record.
      contactEmail:
        typeof body.contactEmail === 'string' && body.contactEmail.trim()
          ? body.contactEmail
          : user.email,
    });
    await audit({
      actorId: user.id,
      projectId: null,
      action: 'migration_request.create',
      ipHash: hashIpFromReq(c.req.raw.headers.get('x-forwarded-for')),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { requestId: request.id, source: request.source },
    });
    // Fire-and-forget notifications. We never want a slow / unreachable
    // mittera to block the POST response — the request is already
    // persisted, so the operator can still triage from the dashboard
    // even if the email pipeline is degraded.
    const emailPayload = {
      requestId: request.id,
      source: request.source,
      contactEmail: request.contactEmail,
      sourceUrl: request.sourceUrl,
      urgency: request.urgency,
      estimatedTables: request.estimatedTables,
      estimatedRows:
        request.estimatedRows == null ? null : request.estimatedRows.toString(),
      estimatedFunctions: request.estimatedFunctions,
      sourceNotes: request.sourceNotes,
    };
    void sendMigrationRequestCustomerConfirmation(emailPayload).catch((err) => {
      log.error('migration_request_customer_email_failed', {
        requestId: request.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    void sendMigrationRequestOperatorAlert(emailPayload).catch((err) => {
      log.error('migration_request_operator_email_failed', {
        requestId: request.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return c.json({ request: serialize(request) }, 201);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    throw err;
  }
});

/**
 * Public, unauthenticated intake. Lives on a separate Hono router so
 * the requireAuth middleware on /v1/migration-requests/* doesn't shadow
 * it. Used by the /migrate marketing page + per-source pages so
 * prospects can request a migration before creating an account. Rate-
 * limited by IP (5/hour) to keep the endpoint from being a spam vector.
 * Triaged by an operator identically to authed requests — the user_id
 * column is null until the operator promotes the lead.
 */
export const migrationRequestsPublicRouter = new Hono<AppEnv>();

migrationRequestsPublicRouter.post(
  '/v1/migration-leads',
  rateLimit({
    scope: 'migration-public',
    limit: 5,
    windowMs: 60 * 60_000,
    key: ipKey,
  }),
  async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return c.json({ code: 'validation_failed', message: 'JSON body required' }, 400);
    }
    const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim() : '';
    if (!contactEmail) {
      return c.json(
        { code: 'validation_failed', message: 'contactEmail is required' },
        400,
      );
    }
    try {
      const request = await createMigrationRequest({
        userId: null,
        source: String(body.source ?? ''),
        sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : null,
        sourceNotes: typeof body.sourceNotes === 'string' ? body.sourceNotes : '',
        urgency: typeof body.urgency === 'string' ? body.urgency : 'exploring',
        contactEmail,
      });
      await audit({
        actorId: null,
        projectId: null,
        action: 'migration_request.public_create',
        ipHash: hashIpFromReq(c.req.raw.headers.get('x-forwarded-for')),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: { requestId: request.id, source: request.source },
      });
      const emailPayload = {
        requestId: request.id,
        source: request.source,
        contactEmail: request.contactEmail,
        sourceUrl: request.sourceUrl,
        urgency: request.urgency,
        estimatedTables: request.estimatedTables,
        estimatedRows:
          request.estimatedRows == null ? null : request.estimatedRows.toString(),
        estimatedFunctions: request.estimatedFunctions,
        sourceNotes: request.sourceNotes,
      };
      void sendMigrationRequestCustomerConfirmation(emailPayload).catch((err) => {
        log.error('migration_request_customer_email_failed', {
          requestId: request.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      void sendMigrationRequestOperatorAlert(emailPayload).catch((err) => {
        log.error('migration_request_operator_email_failed', {
          requestId: request.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      // Funnel-tracking: server-side fire so a public lead-claim from
      // a curl caller can't inflate the conversion count without
      // actually creating a request.
      void trackMarketingEvent({
        eventType: 'migrate_lead_submitted',
        source: request.source,
        ipHash: hashIpFromReq(c.req.raw.headers.get('x-forwarded-for')),
        userAgent: c.req.header('user-agent') ?? null,
      });
      // We deliberately return only the request id — no PII echo to a
      // public endpoint, no leak of contact-email back to a curl caller.
      return c.json({ requestId: request.id }, 201);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      throw err;
    }
  },
);

function hashIpFromReq(forwarded: string | null): string | null {
  const ip = forwarded ? forwarded.split(',')[0]!.trim() : null;
  return hashIp(ip);
}

function toOptionalInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toOptionalBigint(value: unknown): bigint | null {
  if (value == null || value === '') return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string') {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  return null;
}

interface SerializedRequest {
  id: string;
  source: string;
  sourceUrl: string | null;
  sourceNotes: string;
  estimatedTables: number | null;
  estimatedRows: string | null;
  estimatedFunctions: number | null;
  urgency: string;
  status: string;
  contactEmail: string;
  createdAt: string;
  updatedAt: string;
}

function serialize(row: {
  id: string;
  source: string;
  sourceUrl: string | null;
  sourceNotes: string;
  estimatedTables: number | null;
  estimatedRows: bigint | null;
  estimatedFunctions: number | null;
  urgency: string;
  status: string;
  contactEmail: string;
  createdAt: Date;
  updatedAt: Date;
}): SerializedRequest {
  return {
    id: row.id,
    source: row.source,
    sourceUrl: row.sourceUrl,
    sourceNotes: row.sourceNotes,
    estimatedTables: row.estimatedTables,
    estimatedRows: row.estimatedRows == null ? null : row.estimatedRows.toString(),
    estimatedFunctions: row.estimatedFunctions,
    urgency: row.urgency,
    status: row.status,
    contactEmail: row.contactEmail,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
