/**
 * AI auth extras (SuperTokens-class “AI authentication” surface — first cut).
 *
 * Machine identity for AI agents / tools: scoped bearer tokens that prove
 * “this agent is allowed to act for project X” without a human session.
 *
 * Distinct from M2M (developer server credentials): AI tokens are shorter-lived
 * by default and carry agent_name + scopes for audit.
 */

import { createHash, randomBytes } from 'node:crypto';

import { getEnginePool } from './db.js';
import { mapProjectToAuthCore } from './project-map.js';
import { recordBrivenEngineAudit } from './audit.js';

export type AiAgentTokenRow = {
  id: string;
  projectId: string;
  agentName: string;
  scopes: string[];
  hint: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

function hashToken(raw: string): string {
  return createHash('sha256').update(`briven-ai-agent:${raw}`).digest('hex');
}

export async function createAiAgentToken(input: {
  projectId: string;
  agentName: string;
  scopes?: string[];
  /** Hours until expiry; default 24. Max 30 days. */
  ttlHours?: number;
  createdBy?: string | null;
}): Promise<{ token: AiAgentTokenRow; plaintext: string }> {
  const name = input.agentName.trim().slice(0, 80);
  if (!name) throw new Error('agentName required');
  const scopes =
    input.scopes?.length && input.scopes.every((s) => typeof s === 'string')
      ? input.scopes.map((s) => s.trim()).filter(Boolean)
      : ['ai.invoke'];
  const hours = Math.min(Math.max(input.ttlHours ?? 24, 1), 24 * 30);
  const map = mapProjectToAuthCore(input.projectId);
  const id = `aia_${randomBytes(10).toString('hex')}`;
  const plaintext = `brai_${randomBytes(24).toString('base64url')}`;
  const suffix = plaintext.slice(-4);
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000);

  const pool = getEnginePool();
  await pool.query(
    `INSERT INTO be_ai_agent_tokens
      (id, project_id, tenant_id, agent_name, scopes_json, token_hash, token_suffix,
       expires_at, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
    [
      id,
      input.projectId,
      map.tenantId,
      name,
      JSON.stringify(scopes),
      hashToken(plaintext),
      suffix,
      expiresAt.toISOString(),
      input.createdBy ?? null,
    ],
  );

  void recordBrivenEngineAudit({
    action: 'ai.agent_token.created',
    projectId: input.projectId,
    tenantId: map.tenantId,
    userId: input.createdBy ?? null,
    metadata: { agentName: name, scopes, hours },
  });

  return {
    plaintext,
    token: {
      id,
      projectId: input.projectId,
      agentName: name,
      scopes,
      hint: `…${suffix}`,
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    },
  };
}

export async function listAiAgentTokens(
  projectId: string,
): Promise<AiAgentTokenRow[]> {
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT id, project_id, agent_name, scopes_json, token_suffix, expires_at,
            revoked_at, created_at, last_used_at
     FROM be_ai_agent_tokens
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [projectId],
  );
  return (res.rows as Array<Record<string, unknown>>).map((r) => {
    let scopes: string[] = [];
    try {
      scopes = JSON.parse(String(r.scopes_json ?? '[]')) as string[];
    } catch {
      scopes = [];
    }
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      agentName: String(r.agent_name),
      scopes,
      hint: `…${String(r.token_suffix ?? '')}`,
      expiresAt: r.expires_at
        ? r.expires_at instanceof Date
          ? r.expires_at.toISOString()
          : String(r.expires_at)
        : null,
      revokedAt: r.revoked_at
        ? r.revoked_at instanceof Date
          ? r.revoked_at.toISOString()
          : String(r.revoked_at)
        : null,
      createdAt:
        r.created_at instanceof Date
          ? r.created_at.toISOString()
          : String(r.created_at),
      lastUsedAt: r.last_used_at
        ? r.last_used_at instanceof Date
          ? r.last_used_at.toISOString()
          : String(r.last_used_at)
        : null,
    };
  });
}

export async function revokeAiAgentToken(
  projectId: string,
  tokenId: string,
): Promise<void> {
  const pool = getEnginePool();
  const res = await pool.query(
    `UPDATE be_ai_agent_tokens SET revoked_at = NOW()
     WHERE project_id = $1 AND id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [projectId, tokenId],
  );
  if (!res.rowCount) throw new Error('token not found or already revoked');
  void recordBrivenEngineAudit({
    action: 'ai.agent_token.revoked',
    projectId,
    metadata: { tokenId },
  });
}

export async function verifyAiAgentToken(
  plaintext: string,
): Promise<{
  projectId: string;
  agentName: string;
  scopes: string[];
  tokenId: string;
} | null> {
  if (!plaintext.startsWith('brai_')) return null;
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT id, project_id, agent_name, scopes_json, expires_at, revoked_at
     FROM be_ai_agent_tokens WHERE token_hash = $1 LIMIT 1`,
    [hashToken(plaintext)],
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row || row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at as string).getTime() < Date.now()) {
    return null;
  }
  let scopes: string[] = [];
  try {
    scopes = JSON.parse(String(row.scopes_json ?? '[]')) as string[];
  } catch {
    scopes = [];
  }
  await pool.query(
    `UPDATE be_ai_agent_tokens SET last_used_at = NOW() WHERE id = $1`,
    [row.id],
  );
  return {
    tokenId: String(row.id),
    projectId: String(row.project_id),
    agentName: String(row.agent_name),
    scopes,
  };
}
