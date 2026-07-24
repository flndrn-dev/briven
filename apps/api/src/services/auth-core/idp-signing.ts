/**
 * RSA signing keys for OIDC id_token / access_token (RS256 + JWKS).
 * First active key is created on demand and stored in Doltgres.
 */

import { generateKeyPair, exportJWK, exportPKCS8, importPKCS8, type JWK, type KeyLike } from 'jose';
import { randomBytes } from 'node:crypto';

import { getEnginePool } from './db.js';
import { log } from '../../lib/logger.js';

type CachedKey = {
  kid: string;
  privateKey: KeyLike;
  publicJwk: JWK;
};

let cache: CachedKey | null = null;

function newKid(): string {
  return `oidc_${randomBytes(8).toString('hex')}`;
}

export async function ensureOidcSigningKey(): Promise<CachedKey> {
  if (cache) return cache;
  const pool = getEnginePool();
  const existing = await pool.query(
    `SELECT kid, private_pem, public_jwk_json FROM be_oidc_signing_keys
     WHERE active = TRUE ORDER BY created_at DESC LIMIT 1`,
  );
  const row = existing.rows[0] as
    | { kid: string; private_pem: string; public_jwk_json: string }
    | undefined;

  if (row) {
    const privateKey = await importPKCS8(row.private_pem, 'RS256');
    const publicJwk = JSON.parse(row.public_jwk_json) as JWK;
    cache = { kid: row.kid, privateKey, publicJwk };
    return cache;
  }

  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    extractable: true,
  });
  const kid = newKid();
  const privatePem = await exportPKCS8(privateKey);
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.use = 'sig';
  publicJwk.alg = 'RS256';

  await pool.query(
    `INSERT INTO be_oidc_signing_keys (kid, private_pem, public_jwk_json, active, created_at)
     VALUES ($1, $2, $3, TRUE, NOW())`,
    [kid, privatePem, JSON.stringify(publicJwk)],
  );
  log.info('oidc_signing_key_created', { kid, engine: 'briven-engine' });
  cache = { kid, privateKey, publicJwk };
  return cache;
}

export async function getOidcJwks(): Promise<{ keys: JWK[] }> {
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT public_jwk_json FROM be_oidc_signing_keys WHERE active = TRUE ORDER BY created_at DESC`,
  );
  if (res.rows.length === 0) {
    const k = await ensureOidcSigningKey();
    return { keys: [k.publicJwk] };
  }
  const keys = (res.rows as Array<{ public_jwk_json: string }>).map(
    (r) => JSON.parse(r.public_jwk_json) as JWK,
  );
  return { keys };
}
