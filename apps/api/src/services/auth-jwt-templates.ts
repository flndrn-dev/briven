/**
 * JWT Template service — Phase 7.1.
 *
 * Lets tenants define named claim sets ("templates") and request signed JWTs
 * that merge the template claims with user identity claims.  The signing keys
 * live in `_briven_auth_custom_jwks` — independent from Better Auth's own
 * jwks table so we control the lifecycle.
 */

import { generateKeyPair, SignJWT, importJWK, type JWK } from 'jose';

import { runInProjectDatabase } from '../db/data-plane.js';

// ─── template CRUD ────────────────────────────────────────────────────────

export async function listJwtTemplates(projectId: string): Promise<{ name: string; claims: Record<string, unknown> }[]> {
  return runInProjectDatabase(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT name, claims FROM "_briven_auth_jwt_templates" ORDER BY name`,
    )) as Array<{ name: string; claims: unknown }>;
    return rows.map((r) => ({ name: r.name, claims: (r.claims ?? {}) as Record<string, unknown> }));
  });
}

export async function getJwtTemplate(
  projectId: string,
  name: string,
): Promise<{ name: string; claims: Record<string, unknown> } | null> {
  return runInProjectDatabase(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT name, claims FROM "_briven_auth_jwt_templates" WHERE name = $1 LIMIT 1`,
      [name] as never,
    )) as Array<{ name: string; claims: unknown }>;
    if (!rows[0]) return null;
    return { name: rows[0].name, claims: (rows[0].claims ?? {}) as Record<string, unknown> };
  });
}

export async function createJwtTemplate(
  projectId: string,
  name: string,
  claims: Record<string, unknown>,
): Promise<void> {
  const id = crypto.randomUUID();
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_jwt_templates" (id, name, claims) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`,
      [id, name, JSON.stringify(claims)] as never,
    );
  });
}

export async function deleteJwtTemplate(projectId: string, name: string): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `DELETE FROM "_briven_auth_jwt_templates" WHERE name = $1`,
      [name] as never,
    );
  });
}

// ─── signing key lifecycle ────────────────────────────────────────────────

async function ensureSigningKey(projectId: string): Promise<{ publicKey: JWK; privateKey: JWK }> {
  const existing = await runInProjectDatabase(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT public_key, private_key FROM "_briven_auth_custom_jwks" LIMIT 1`,
    )) as Array<{ public_key: string; private_key: string }>;
    return rows[0] ?? null;
  });

  if (existing) {
    return {
      publicKey: JSON.parse(existing.public_key) as JWK,
      privateKey: JSON.parse(existing.private_key) as JWK,
    };
  }

  const pair = await generateKeyPair('Ed25519', { extractable: true });
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

  const publicJson = JSON.stringify(publicJwk);
  const privateJson = JSON.stringify(privateJwk);

  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_custom_jwks" (id, public_key, private_key) VALUES ($1, $2, $3)`,
      [crypto.randomUUID(), publicJson, privateJson] as never,
    );
  });

  return { publicKey: publicJwk, privateKey: privateJwk };
}

export async function getCustomJwks(projectId: string): Promise<{ keys: JWK[] }> {
  const rows = await runInProjectDatabase(projectId, async (tx) => {
    return (await tx.unsafe(
      `SELECT public_key FROM "_briven_auth_custom_jwks"`,
    )) as Array<{ public_key: string }>;
  });
  return {
    keys: rows.map((r) => JSON.parse(r.public_key) as JWK),
  };
}

// ─── JWT generation ───────────────────────────────────────────────────────

export interface JwtTokenResult {
  token: string;
  expiresAt: Date;
}

export async function generateJwtToken(
  projectId: string,
  sessionToken: string,
  templateName?: string,
): Promise<JwtTokenResult | { error: string }> {
  // 1. Validate session.
  const session = await runInProjectDatabase(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT id, user_id, expires_at FROM "_briven_auth_sessions" WHERE token = $1 LIMIT 1`,
      [sessionToken] as never,
    )) as Array<{ id: string; user_id: string; expires_at: Date }>;
    if (!rows[0]) return null;
    // Check expiry
    if (rows[0].expires_at < new Date()) return null;
    return rows[0];
  });

  if (!session) {
    return { error: 'invalid_session' };
  }

  // 2. Fetch user.
  const user = await runInProjectDatabase(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT id, email, name, image FROM "_briven_auth_users" WHERE id = $1 LIMIT 1`,
      [session.user_id] as never,
    )) as Array<{ id: string; email: string; name: string | null; image: string | null }>;
    return rows[0] ?? null;
  });

  if (!user) {
    return { error: 'user_not_found' };
  }

  // 3. Fetch template claims if requested.
  let templateClaims: Record<string, unknown> = {};
  if (templateName) {
    const tpl = await getJwtTemplate(projectId, templateName);
    if (!tpl) {
      return { error: 'template_not_found' };
    }
    templateClaims = tpl.claims;
  }

  // 4. Ensure signing key.
  const { privateKey } = await ensureSigningKey(projectId);
  const cryptoKey = await importJWK(privateKey, 'EdDSA');

  // 5. Build and sign JWT.
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  const token = await new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name ?? null,
    image: user.image ?? null,
    ...templateClaims,
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setSubject(user.id)
    .sign(cryptoKey);

  return { token, expiresAt };
}
