/**
 * briven-engine passwordless: magic link (email) + OTP (email/SMS) on Doltgres.
 */

import { createHash, randomBytes } from 'node:crypto';

import { newId } from '@briven/shared';

import { log } from '../../lib/logger.js';
import { env } from '../../env.js';
import { getEnginePool } from './db.js';
import {
  sendBrivenEngineEmail,
  sendBrivenEngineSms,
} from './delivery.js';
import { createEngineSession } from './native-session.js';
import { projectIdToTenantId } from './project-map.js';

const CODE_TTL_MS = 15 * 60 * 1000;

function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sixDigitCode(): string {
  // 100000–999999
  const n = 100000 + (randomBytes(3).readUIntBE(0, 3) % 900000);
  return String(n);
}

function resolveTenant(input: {
  tenantId?: string;
  projectId?: string;
}): string {
  if (input.tenantId) return input.tenantId;
  if (input.projectId) return projectIdToTenantId(input.projectId);
  return 'public';
}

async function ensureTenant(tenantId: string, projectId?: string): Promise<void> {
  const pool = getEnginePool();
  const existing = await pool.query(
    `SELECT tenant_id FROM be_tenants WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (!existing.rowCount) {
    await pool.query(
      `INSERT INTO be_tenants (tenant_id, project_id) VALUES ($1, $2)`,
      [tenantId, projectId ?? tenantId],
    );
  }
}

export type CreatePasswordlessCodeResult =
  | {
      status: 'OK';
      preAuthSessionId: string;
      deviceId: string;
      /** Only returned in non-production for local proof (never log in prod paths). */
      userInputCode?: string;
      /** Magic link for email flows (app should host consume page). */
      linkCode?: string;
      flowType: 'USER_INPUT_CODE' | 'MAGIC_LINK' | 'USER_INPUT_CODE_AND_MAGIC_LINK';
      channel: 'email' | 'sms';
      delivery: { ok: boolean; mode: string; message?: string };
    }
  | { status: 'BAD_REQUEST'; message: string };

/**
 * Create a passwordless code for email or phone.
 * flow: USER_INPUT_CODE (OTP), MAGIC_LINK, or both.
 */
export async function createPasswordlessCode(input: {
  email?: string;
  phoneNumber?: string;
  projectId?: string;
  tenantId?: string;
  /** Prefer USER_INPUT_CODE | MAGIC_LINK | both */
  flowType?: 'USER_INPUT_CODE' | 'MAGIC_LINK' | 'USER_INPUT_CODE_AND_MAGIC_LINK';
  /** Base URL for magic link, e.g. https://app.example.com/auth/verify */
  magicLinkBaseUrl?: string;
}): Promise<CreatePasswordlessCodeResult> {
  const email = input.email?.trim().toLowerCase();
  const phone = input.phoneNumber?.trim();
  if (!email && !phone) {
    return { status: 'BAD_REQUEST', message: 'email or phoneNumber required' };
  }
  if (email && phone) {
    return {
      status: 'BAD_REQUEST',
      message: 'provide only one of email or phoneNumber',
    };
  }

  const channel: 'email' | 'sms' = email ? 'email' : 'sms';
  const flowType =
    input.flowType ??
    (channel === 'sms'
      ? 'USER_INPUT_CODE'
      : 'USER_INPUT_CODE_AND_MAGIC_LINK');

  const tenantId = resolveTenant(input);
  await ensureTenant(tenantId, input.projectId);

  const preAuthSessionId = `pas_${randomBytes(16).toString('hex')}`;
  const deviceId = `dev_${randomBytes(12).toString('hex')}`;
  const userInputCode =
    flowType === 'MAGIC_LINK' ? undefined : sixDigitCode();
  const linkCode =
    flowType === 'USER_INPUT_CODE'
      ? undefined
      : randomBytes(24).toString('base64url');

  // Store one hash that accept-path can verify:
  // - OTP only → hash(otp)
  // - link only → hash(link)
  // - both → hash(otp) AND we store otp in code_hash via dual-row style:
  //   Prefer storing hash of OTP when present (primary), plus hash of link
  //   in a second column would need schema change — use combined secret
  //   "otp||link" and accept either piece by re-checking against stored
  //   candidates at create time in a deterministic way:
  //   store hash(otp) if only otp; hash(link) if only link;
  //   if both: store hash(otp) as primary and also accept link via separate
  //   optional field. For simplicity with one column: store BOTH hashes
  //   joined as "otpHash:linkHash" when both present.
  let codeHash: string;
  if (userInputCode && linkCode) {
    codeHash = `${hashSecret(userInputCode)}:${hashSecret(linkCode)}`;
  } else if (userInputCode) {
    codeHash = hashSecret(userInputCode);
  } else {
    codeHash = hashSecret(linkCode!);
  }
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  const pool = getEnginePool();
  await pool.query(
    `INSERT INTO be_passwordless_codes
      (pre_auth_session_id, tenant_id, email, phone, code_hash, device_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      preAuthSessionId,
      tenantId,
      email ?? null,
      phone ?? null,
      codeHash,
      deviceId,
      expiresAt.toISOString(),
    ],
  );

  let delivery: { ok: boolean; mode: string; message?: string } = {
    ok: true,
    mode: 'log',
  };

  if (channel === 'email' && email) {
    const base =
      input.magicLinkBaseUrl ??
      `${(env.BRIVEN_WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '')}/auth/verify`;
    const urlWithLinkCode = linkCode
      ? `${base}?preAuthSessionId=${encodeURIComponent(preAuthSessionId)}&linkCode=${encodeURIComponent(linkCode)}&deviceId=${encodeURIComponent(deviceId)}`
      : undefined;
    const bodyParts = [
      userInputCode ? `Your Briven Auth code: ${userInputCode}` : null,
      urlWithLinkCode ? `Magic link: ${urlWithLinkCode}` : null,
      `Expires in ${CODE_TTL_MS / 60000} minutes.`,
    ].filter(Boolean);
    const sent = await sendBrivenEngineEmail({
      email,
      subject: 'Your Briven Auth sign-in',
      body: bodyParts.join('\n'),
      type: 'PASSWORDLESS_LOGIN',
      projectId: input.projectId,
    });
    delivery = {
      ok: sent.ok,
      mode: sent.mode,
      message: sent.message,
    };
  } else if (channel === 'sms' && phone) {
    const sent = await sendBrivenEngineSms({
      phoneNumber: phone,
      userInputCode,
      codeLifetime: CODE_TTL_MS,
      type: 'PASSWORDLESS_LOGIN',
      projectId: input.projectId,
    });
    delivery = {
      ok: sent.ok,
      mode: sent.mode,
      message: sent.message,
    };
  }

  log.info('briven_engine_passwordless_created', {
    engine: 'briven-engine',
    storage: 'doltgres',
    channel,
    flowType,
    tenantId,
    deliveryMode: delivery.mode,
  });

  return {
    status: 'OK',
    preAuthSessionId,
    deviceId,
    userInputCode:
      env.BRIVEN_ENV === 'production' ? undefined : userInputCode,
    linkCode: env.BRIVEN_ENV === 'production' ? undefined : linkCode,
    flowType,
    channel,
    delivery,
  };
}

export type ConsumePasswordlessCodeResult =
  | {
      status: 'OK';
      createdNewUser: boolean;
      user: { id: string; email?: string; phone?: string; tenantId: string };
      session: {
        handle: string;
        userId: string;
        accessToken: string;
        refreshToken: string;
      };
    }
  | { status: 'RESTART_FLOW_ERROR' | 'INCORRECT_USER_INPUT_CODE_ERROR' | 'EXPIRED' | 'BAD_REQUEST'; message?: string };

/**
 * Consume OTP and/or magic link code → user + session on Doltgres.
 */
export async function consumePasswordlessCode(input: {
  preAuthSessionId: string;
  deviceId: string;
  userInputCode?: string;
  linkCode?: string;
  projectId?: string;
  tenantId?: string;
}): Promise<ConsumePasswordlessCodeResult> {
  if (!input.userInputCode && !input.linkCode) {
    return {
      status: 'BAD_REQUEST',
      message: 'userInputCode or linkCode required',
    };
  }

  const pool = getEnginePool();
  const res = await pool.query(
    `SELECT pre_auth_session_id, tenant_id, email, phone, code_hash, device_id, expires_at
     FROM be_passwordless_codes
     WHERE pre_auth_session_id = $1
     LIMIT 1`,
    [input.preAuthSessionId],
  );
  const row = res.rows[0] as
    | {
        pre_auth_session_id: string;
        tenant_id: string;
        email: string | null;
        phone: string | null;
        code_hash: string;
        device_id: string;
        expires_at: Date | string;
      }
    | undefined;

  if (!row) {
    return { status: 'RESTART_FLOW_ERROR', message: 'unknown preAuthSessionId' };
  }
  if (row.device_id !== input.deviceId) {
    return { status: 'RESTART_FLOW_ERROR', message: 'deviceId mismatch' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await pool.query(
      `DELETE FROM be_passwordless_codes WHERE pre_auth_session_id = $1`,
      [input.preAuthSessionId],
    );
    return { status: 'EXPIRED', message: 'code expired' };
  }

  // Verify OTP and/or magic link against stored hash form.
  let matched = false;
  const stored = row.code_hash;
  if (stored.includes(':')) {
    const [otpHash, linkHash] = stored.split(':');
    if (input.userInputCode && hashSecret(input.userInputCode) === otpHash) {
      matched = true;
    }
    if (input.linkCode && hashSecret(input.linkCode) === linkHash) {
      matched = true;
    }
  } else {
    if (input.userInputCode && hashSecret(input.userInputCode) === stored) {
      matched = true;
    }
    if (input.linkCode && hashSecret(input.linkCode) === stored) {
      matched = true;
    }
  }
  if (!matched) {
    return { status: 'INCORRECT_USER_INPUT_CODE_ERROR' };
  }

  // One-time use
  await pool.query(
    `DELETE FROM be_passwordless_codes WHERE pre_auth_session_id = $1`,
    [input.preAuthSessionId],
  );

  const tenantId = row.tenant_id;
  let userId: string | null = null;
  let createdNewUser = false;

  if (row.email) {
    const found = await pool.query(
      `SELECT id FROM be_users WHERE tenant_id = $1 AND email = $2 LIMIT 1`,
      [tenantId, row.email],
    );
    if (found.rows[0]) {
      userId = (found.rows[0] as { id: string }).id;
    } else {
      userId = newId('beu');
      createdNewUser = true;
      await pool.query(
        `INSERT INTO be_users (id, tenant_id, email, email_verified)
         VALUES ($1, $2, $3, TRUE)`,
        [userId, tenantId, row.email],
      );
    }
  } else if (row.phone) {
    const found = await pool.query(
      `SELECT id FROM be_users WHERE tenant_id = $1 AND phone = $2 LIMIT 1`,
      [tenantId, row.phone],
    );
    if (found.rows[0]) {
      userId = (found.rows[0] as { id: string }).id;
    } else {
      userId = newId('beu');
      createdNewUser = true;
      await pool.query(
        `INSERT INTO be_users (id, tenant_id, phone, email_verified)
         VALUES ($1, $2, $3, TRUE)`,
        [userId, tenantId, row.phone],
      );
    }
  }

  if (!userId) {
    return { status: 'RESTART_FLOW_ERROR', message: 'no contact on code' };
  }

  const session = await createEngineSession({ userId, tenantId });

  return {
    status: 'OK',
    createdNewUser,
    user: {
      id: userId,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      tenantId,
    },
    session: {
      handle: session.sessionHandle,
      userId: session.userId,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    },
  };
}
