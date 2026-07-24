/**
 * briven-engine security audit trail on Doltgres.
 *
 * Writes auth events (sign-in, fail, logout, secret change) for operator review.
 * Never stores raw IPs — only a short hash hint (CLAUDE.md §5.1).
 */

import { createHash, randomBytes } from 'node:crypto';

import { getEnginePool } from './db.js';
import { mapProjectToAuthCore } from './project-map.js';
import { log } from '../../lib/logger.js';

export type BrivenEngineAuditAction =
  | 'signin.password'
  | 'signin.password.fail'
  | 'signup.password'
  | 'signin.passwordless'
  | 'signin.passwordless.code_created'
  | 'signin.passwordless.fail'
  | 'signin.social'
  | 'signin.social.fail'
  | 'signin.passkey'
  | 'signin.sso'
  | 'session.created'
  | 'session.revoked'
  | 'mfa.totp.verified'
  | 'mfa.totp.fail'
  | 'config.methods.updated'
  | 'config.sms_secrets.saved'
  | 'config.oauth_secrets.saved'
  | 'config.branding.saved'
  | 'm2m.client.created'
  | 'm2m.client.revoked'
  | 'm2m.token.issued'
  | 'm2m.token.fail'
  | 'oidc.client.created'
  | 'oidc.client.revoked'
  | 'oidc.consent.granted'
  | 'oidc.consent.denied'
  | 'oidc.code.issued'
  | 'oidc.token.issued'
  | 'oidc.token.revoked'

export type RecordBrivenEngineAuditInput = {
  action: BrivenEngineAuditAction | string;
  tenantId?: string | null;
  projectId?: string | null;
  userId?: string | null;
  /** Raw IP — hashed to a short hint before store. */
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

export type BrivenEngineAuditRow = {
  id: string;
  tenantId: string;
  projectId: string | null;
  userId: string | null;
  action: string;
  /** First 8 chars of hash — correlation only, never raw IP. */
  ipHashHint: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

function newAuditId(): string {
  return `bea_${randomBytes(12).toString('hex')}`;
}

/** Short correlation hint only — never store or return the raw IP. */
export function auditIpHashHint(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const full = createHash('sha256').update(`briven-engine-audit:${ip}`).digest('hex');
  return full.slice(0, 8);
}

function ipHint(ip: string | null | undefined): string | null {
  return auditIpHashHint(ip);
}

/**
 * Fire-and-forget friendly: never throws to callers (auth must not fail on audit).
 */
export async function recordBrivenEngineAudit(
  input: RecordBrivenEngineAuditInput,
): Promise<void> {
  try {
    let tenantId = input.tenantId?.trim() || null;
    let projectId = input.projectId?.trim() || null;
    if (projectId && !tenantId) {
      tenantId = mapProjectToAuthCore(projectId).tenantId;
    }
    if (!tenantId) tenantId = 'public';

    const pool = getEnginePool();
    const id = newAuditId();
    const ua = input.userAgent?.slice(0, 512) ?? null;
    const meta = JSON.stringify(input.metadata ?? {});
    await pool.query(
      `INSERT INTO be_audit_events
        (id, tenant_id, project_id, user_id, action, ip_hash_hint, user_agent, metadata_json, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        id,
        tenantId,
        projectId,
        input.userId ?? null,
        input.action,
        ipHint(input.ip),
        ua,
        meta,
      ],
    );
  } catch (err) {
    log.warn('briven_engine_audit_write_failed', {
      action: input.action,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function listBrivenEngineAudit(opts: {
  projectId: string;
  limit?: number;
  action?: string | null;
  userId?: string | null;
}): Promise<{ ok: true; engine: 'briven-engine'; items: BrivenEngineAuditRow[] }> {
  const map = mapProjectToAuthCore(opts.projectId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const pool = getEnginePool();

  const params: unknown[] = [map.tenantId, opts.projectId];
  let where =
    '(tenant_id = $1 OR project_id = $2)';
  if (opts.action) {
    params.push(opts.action);
    where += ` AND action = $${params.length}`;
  }
  if (opts.userId) {
    params.push(opts.userId);
    where += ` AND user_id = $${params.length}`;
  }
  params.push(limit);

  const res = await pool.query(
    `SELECT id, tenant_id, project_id, user_id, action, ip_hash_hint, user_agent, metadata_json, occurred_at
     FROM be_audit_events
     WHERE ${where}
     ORDER BY occurred_at DESC
     LIMIT $${params.length}`,
    params,
  );

  const items: BrivenEngineAuditRow[] = (res.rows as Array<Record<string, unknown>>).map(
    (r) => {
      let metadata: Record<string, unknown> = {};
      try {
        metadata = JSON.parse(String(r.metadata_json ?? '{}')) as Record<
          string,
          unknown
        >;
      } catch {
        metadata = {};
      }
      return {
        id: String(r.id),
        tenantId: String(r.tenant_id),
        projectId: r.project_id ? String(r.project_id) : null,
        userId: r.user_id ? String(r.user_id) : null,
        action: String(r.action),
        ipHashHint: r.ip_hash_hint ? String(r.ip_hash_hint) : null,
        userAgent: r.user_agent ? String(r.user_agent) : null,
        metadata,
        occurredAt:
          r.occurred_at instanceof Date
            ? r.occurred_at.toISOString()
            : String(r.occurred_at),
      };
    },
  );

  return { ok: true, engine: 'briven-engine', items };
}
