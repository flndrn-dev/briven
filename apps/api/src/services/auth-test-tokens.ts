/**
 * Testing tokens — Phase 7.4.
 *
 * Special tokens for E2E test suites that bypass bot protection,
 * rate limiting, and MFA requirements.  Created via the admin API;
 * exchanged for a real session via the customer API.
 *
 * Tokens are SHA-256 hashed at rest (same pattern as sign-in tokens).
 * The raw token is returned exactly once — on creation.
 */

import { createHash, randomBytes } from 'node:crypto';
import { runInProjectDatabase } from '../db/data-plane.js';

const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRawTestToken(): string {
  return `briven_test_${randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

export interface TestTokenResult {
  id: string;
  token: string;
  name: string | null;
  expiresAt: Date;
}

export async function createTestToken(
  projectId: string,
  userId: string,
  name?: string,
): Promise<TestTokenResult> {
  const raw = generateRawTestToken();
  const tokenHash = hashToken(raw);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_test_tokens" (id, user_id, token_hash, name, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [id, userId, tokenHash, name ?? null, expiresAt] as never,
    );
  });

  return { id, token: raw, name: name ?? null, expiresAt };
}

export async function listTestTokens(
  projectId: string,
): Promise<Array<{ id: string; userId: string; name: string | null; expiresAt: Date; createdAt: Date }>> {
  const rows = await runInProjectDatabase(projectId, async (tx) => {
    return (await tx.unsafe(
      `SELECT id, user_id, name, expires_at, created_at FROM "_briven_auth_test_tokens" ORDER BY created_at DESC`,
    )) as Array<{ id: string; user_id: string; name: string | null; expires_at: Date; created_at: Date }>;
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));
}

export async function revokeTestToken(projectId: string, tokenId: string): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `DELETE FROM "_briven_auth_test_tokens" WHERE id = $1`,
      [tokenId] as never,
    );
  });
}

export async function exchangeTestToken(
  projectId: string,
  token: string,
): Promise<{ userId: string; sessionToken: string; expiresAt: Date } | null> {
  const tokenHash = hashToken(token);

  const row = await runInProjectDatabase(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT user_id, expires_at FROM "_briven_auth_test_tokens" WHERE token_hash = $1 LIMIT 1`,
      [tokenHash] as never,
    )) as Array<{ user_id: string; expires_at: Date }>;
    return rows[0] ?? null;
  });

  if (!row) return null;
  if (row.expires_at < new Date()) return null;

  // Create a session directly — same shape as Better Auth sessions.
  const sessionToken = randomBytes(32).toString('hex');
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_sessions" (id, user_id, token, expires_at, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())`,
      [sessionId, row.user_id, sessionToken, expiresAt] as never,
    );
  });

  return { userId: row.user_id, sessionToken, expiresAt };
}
