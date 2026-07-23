/**
 * briven-engine MFA (TOTP) on Doltgres only.
 * Pure HMAC-SHA1 TOTP (RFC 6238) — no stock Postgres, no SuperTokens Core.
 */

import { createHmac, randomBytes } from 'node:crypto';

import { newId } from '@briven/shared';

import { getEnginePool } from './db.js';
import { isAuthCoreInitialized } from './engine.js';
import { projectIdToTenantId } from './project-map.js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function toBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: bigint): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function generateTotpCode(secretBase32: string, atMs = Date.now()): string {
  const secret = fromBase32(secretBase32);
  const counter = BigInt(Math.floor(atMs / 1000 / 30));
  return hotp(secret, counter);
}

export function verifyTotpCode(
  secretBase32: string,
  code: string,
  window = 1,
  atMs = Date.now(),
): boolean {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  for (let w = -window; w <= window; w++) {
    const t = atMs + w * 30_000;
    if (generateTotpCode(secretBase32, t) === normalized) return true;
  }
  return false;
}

export async function createTotpDevice(
  userId: string,
  deviceName: string,
  opts?: { projectId?: string; tenantId?: string; issuer?: string },
): Promise<{
  ok: boolean;
  engine: 'briven-engine';
  storage?: 'doltgres';
  deviceId?: string;
  deviceName?: string;
  secret?: string;
  otpauthUrl?: string;
  qrCodeString?: string;
  message?: string;
}> {
  if (!isAuthCoreInitialized()) {
    return { ok: false, engine: 'briven-engine', message: 'engine not ready' };
  }
  const tenantId =
    opts?.tenantId ??
    (opts?.projectId ? projectIdToTenantId(opts.projectId) : 'public');
  const secret = toBase32(randomBytes(20));
  const id = newId('btd');
  const name = deviceName.trim() || 'default';
  const pool = getEnginePool();
  await pool.query(
    `INSERT INTO be_totp_devices (id, user_id, tenant_id, device_name, secret_base32, verified)
     VALUES ($1, $2, $3, $4, $5, FALSE)`,
    [id, userId, tenantId, name, secret],
  );
  const issuer = encodeURIComponent(opts?.issuer ?? 'Briven Auth');
  const label = encodeURIComponent(`${issuer}:${userId}`);
  const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  return {
    ok: true,
    engine: 'briven-engine',
    storage: 'doltgres',
    deviceId: id,
    deviceName: name,
    secret,
    otpauthUrl,
    qrCodeString: otpauthUrl,
  };
}

export async function verifyAndEnableTotpDevice(input: {
  userId: string;
  deviceId?: string;
  deviceName?: string;
  code: string;
}): Promise<{ ok: boolean; engine: 'briven-engine'; message?: string }> {
  if (!isAuthCoreInitialized()) {
    return { ok: false, engine: 'briven-engine', message: 'engine not ready' };
  }
  const pool = getEnginePool();
  let row: { id: string; secret_base32: string } | undefined;
  if (input.deviceId) {
    const res = await pool.query(
      `SELECT id, secret_base32 FROM be_totp_devices WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [input.deviceId, input.userId],
    );
    row = res.rows[0] as typeof row;
  } else if (input.deviceName) {
    const res = await pool.query(
      `SELECT id, secret_base32 FROM be_totp_devices
       WHERE user_id = $1 AND device_name = $2 ORDER BY created_at DESC LIMIT 1`,
      [input.userId, input.deviceName],
    );
    row = res.rows[0] as typeof row;
  }
  if (!row) {
    return { ok: false, engine: 'briven-engine', message: 'device not found' };
  }
  if (!verifyTotpCode(row.secret_base32, input.code)) {
    return { ok: false, engine: 'briven-engine', message: 'invalid code' };
  }
  await pool.query(
    `UPDATE be_totp_devices SET verified = TRUE WHERE id = $1`,
    [row.id],
  );
  return { ok: true, engine: 'briven-engine' };
}

export async function verifyUserTotp(
  userId: string,
  code: string,
): Promise<{ ok: boolean; engine: 'briven-engine' }> {
  if (!isAuthCoreInitialized()) return { ok: false, engine: 'briven-engine' };
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT secret_base32 FROM be_totp_devices WHERE user_id = $1 AND verified = TRUE`,
    [userId],
  );
  for (const row of res.rows as Array<{ secret_base32: string }>) {
    if (verifyTotpCode(row.secret_base32, code)) {
      return { ok: true, engine: 'briven-engine' };
    }
  }
  return { ok: false, engine: 'briven-engine' };
}

/** True if user has at least one verified TOTP device. */
export async function userHasVerifiedTotp(userId: string): Promise<boolean> {
  if (!isAuthCoreInitialized()) return false;
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT 1 AS ok FROM be_totp_devices
     WHERE user_id = $1 AND verified = TRUE LIMIT 1`,
    [userId],
  );
  return Boolean(res.rowCount && res.rowCount > 0);
}

export async function listTotpDevices(userId: string): Promise<{
  engine: 'briven-engine';
  storage: 'doltgres';
  devices: Array<{ id: string; name: string; verified: boolean }>;
}> {
  if (!isAuthCoreInitialized()) {
    return { engine: 'briven-engine', storage: 'doltgres', devices: [] };
  }
  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT id, device_name, verified FROM be_totp_devices WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return {
    engine: 'briven-engine',
    storage: 'doltgres',
    devices: (res.rows as Array<{ id: string; device_name: string; verified: boolean }>).map(
      (d) => ({
        id: d.id,
        name: d.device_name,
        verified: d.verified,
      }),
    ),
  };
}

export async function removeTotpDevice(
  userId: string,
  deviceNameOrId: string,
): Promise<{ ok: boolean; engine: 'briven-engine' }> {
  if (!isAuthCoreInitialized()) return { ok: false, engine: 'briven-engine' };
  const pool = getEnginePool();
  const res = await pool.query(
    `DELETE FROM be_totp_devices WHERE user_id = $1 AND (id = $2 OR device_name = $2)`,
    [userId, deviceNameOrId],
  );
  return { ok: (res.rowCount ?? 0) > 0, engine: 'briven-engine' };
}
