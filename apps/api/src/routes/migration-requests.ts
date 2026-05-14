import { ValidationError } from '@briven/shared';
import { Hono } from 'hono';

import { requireAuth } from '../middleware/session.js';
import { audit, hashIp } from '../services/audit.js';
import {
  createMigrationRequest,
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
    return c.json({ request: serialize(request) }, 201);
  } catch (err) {
    if (err instanceof ValidationError) {
      return c.json({ code: 'validation_failed', message: err.message }, 400);
    }
    throw err;
  }
});

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
