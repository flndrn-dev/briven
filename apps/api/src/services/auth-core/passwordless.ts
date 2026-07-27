/**
 * briven-engine passwordless: magic link (email) + OTP (email/SMS) on Doltgres.
 */

import { createHash, randomBytes } from 'node:crypto';

import { newId } from '@briven/shared';

import { log } from '../../lib/logger.js';
import { env } from '../../env.js';
import { getEnginePool } from './db.js';
import {
  authEmailSubject,
  sendBrivenEngineEmail,
  sendBrivenEngineSms,
} from './delivery.js';
import { createEngineSession } from './native-session.js';
import {
  getBrivenEngineAppOrigins,
  getBrivenEngineBranding,
} from './project-config.js';
import { projectIdToTenantId } from './project-map.js';

const CODE_TTL_MS = 15 * 60 * 1000;

/**
 * Where the magic-link email should send the user.
 * Prefer: explicit base from the app → project Allowed Domains → request Origin
 * → never the platform marketing site (briven.tech) for customer projects.
 */
export function pickMagicLinkAppOrigin(
  origins: string[],
  requestOrigin?: string | null,
): string | null {
  const norm = origins
    .map((o) => {
      try {
        const u = new URL(o.includes('://') ? o : `https://${o}`);
        return `${u.protocol}//${u.host}`;
      } catch {
        return null;
      }
    })
    .filter((o): o is string => Boolean(o));

  if (requestOrigin) {
    try {
      const u = new URL(requestOrigin);
      const ro = `${u.protocol}//${u.host}`;
      if (norm.includes(ro)) return ro;
    } catch {
      /* ignore bad Origin */
    }
  }

  const prod = norm.find(
    (o) =>
      o.startsWith('https://') &&
      !/localhost|127\.0\.0\.1/i.test(o),
  );
  if (prod) return prod;
  return norm[0] ?? null;
}

export async function resolveMagicLinkBaseUrl(input: {
  explicit?: string | null;
  projectId?: string;
  requestOrigin?: string | null;
}): Promise<string> {
  const explicit = input.explicit?.trim();
  if (explicit) {
    // App may send full verify path or just origin.
    if (/\/auth\/verify\/?$/i.test(explicit) || /\/login\/magic\/?$/i.test(explicit)) {
      return explicit.replace(/\/$/, '');
    }
    return `${explicit.replace(/\/$/, '')}/auth/verify`;
  }

  let origins: string[] = [];
  if (input.projectId) {
    try {
      origins = await getBrivenEngineAppOrigins(input.projectId);
    } catch {
      origins = [];
    }
  }

  const picked = pickMagicLinkAppOrigin(origins, input.requestOrigin);
  if (picked) return `${picked}/auth/verify`;

  // Last resort for local engine tests only — not for multi-tenant product mail.
  return `${(env.BRIVEN_WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '')}/auth/verify`;
}

/** Exported for unit tests. */
export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Exported for unit tests. 100000–999999 */
export function sixDigitCode(): string {
  const n = 100000 + (randomBytes(3).readUIntBE(0, 3) % 900000);
  return String(n);
}

/**
 * Pure verify for stored code_hash forms:
 * - single: hash(otp) or hash(link)
 * - dual: "otpHash:linkHash"
 */
export function matchPasswordlessSecret(
  stored: string,
  input: { userInputCode?: string; linkCode?: string },
): boolean {
  if (!input.userInputCode && !input.linkCode) return false;
  if (stored.includes(':')) {
    const [otpHash, linkHash] = stored.split(':');
    if (input.userInputCode && hashSecret(input.userInputCode) === otpHash) {
      return true;
    }
    if (input.linkCode && hashSecret(input.linkCode) === linkHash) {
      return true;
    }
    return false;
  }
  if (input.userInputCode && hashSecret(input.userInputCode) === stored) {
    return true;
  }
  if (input.linkCode && hashSecret(input.linkCode) === stored) {
    return true;
  }
  return false;
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
  /** Browser Origin / Referer — used when magicLinkBaseUrl omitted */
  requestOrigin?: string | null;
  /** User-Agent of the browser that requested the code (for email meta). */
  userAgent?: string | null;
  /** Client IP that requested the code (for email meta + geo). */
  clientIp?: string | null;
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
    // Brand name from Auth → Branding (e.g. "mavi pay"), never hardcode "Briven Auth".
    const branding = input.projectId
      ? await getBrivenEngineBranding(input.projectId)
      : null;
    const appName = branding?.senderName?.trim() || 'your app';
    const expiryMinutes = Math.round(CODE_TTL_MS / 60000);

    const base = await resolveMagicLinkBaseUrl({
      explicit: input.magicLinkBaseUrl,
      projectId: input.projectId,
      requestOrigin: input.requestOrigin,
    });
    // Only build a magic-link URL when this flow actually requested one.
    // OTP-only must not include a link (and vice versa for magic-link-only).
    const urlWithLinkCode =
      linkCode && flowType !== 'USER_INPUT_CODE'
        ? `${base}?preAuthSessionId=${encodeURIComponent(preAuthSessionId)}&linkCode=${encodeURIComponent(linkCode)}&deviceId=${encodeURIComponent(deviceId)}`
        : undefined;
    const otpForEmail =
      userInputCode && flowType !== 'MAGIC_LINK' ? userInputCode : undefined;

    const subject =
      otpForEmail && !urlWithLinkCode
        ? authEmailSubject(appName, 'code', otpForEmail)
        : authEmailSubject(appName, 'sign-in');

    // Plain-text fallback for clients that ignore HTML (still no dual-channel leak).
    const textParts = [
      otpForEmail ? `Your ${appName} Auth code: ${otpForEmail}` : null,
      urlWithLinkCode
        ? `Sign in to ${appName}: open the button in the HTML version of this email, or visit:\n${urlWithLinkCode}`
        : null,
      `Expires in ${expiryMinutes} minutes.`,
      `If you didn't request this, you can ignore this email.`,
    ].filter(Boolean);

    const sent = await sendBrivenEngineEmail({
      email,
      subject,
      body: textParts.join('\n\n'),
      type: 'PASSWORDLESS_LOGIN',
      projectId: input.projectId,
      // Structured fields drive the professional HTML (button / big code).
      url: urlWithLinkCode ?? null,
      code: otpForEmail ?? null,
      expiryMinutes,
      title: `sign in to ${appName}`,
      ctaLabel: 'sign in',
      userAgent: input.userAgent,
      clientIp: input.clientIp,
    });
    delivery = {
      ok: sent.ok,
      mode: sent.mode,
      message: sent.message,
    };
  } else if (channel === 'sms' && phone) {
    const branding = input.projectId
      ? await getBrivenEngineBranding(input.projectId)
      : null;
    const appName = branding?.senderName?.trim() || 'your app';
    const sent = await sendBrivenEngineSms({
      phoneNumber: phone,
      userInputCode,
      codeLifetime: CODE_TTL_MS,
      type: 'PASSWORDLESS_LOGIN',
      projectId: input.projectId,
      userContext: { appName, projectId: input.projectId },
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

  const { recordBrivenEngineAudit } = await import('./audit.js');
  void recordBrivenEngineAudit({
    action: 'signin.passwordless.code_created',
    tenantId,
    projectId: input.projectId,
    metadata: {
      channel,
      flowType,
      deliveryOk: delivery.ok,
      deliveryMode: delivery.mode,
      hasEmail: Boolean(email),
      hasPhone: Boolean(phone),
    },
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

  if (
    !matchPasswordlessSecret(row.code_hash, {
      userInputCode: input.userInputCode,
      linkCode: input.linkCode,
    })
  ) {
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

  const { recordBrivenEngineAudit } = await import('./audit.js');
  void recordBrivenEngineAudit({
    action: 'signin.passwordless',
    tenantId,
    projectId: input.projectId,
    userId,
    metadata: {
      createdNewUser,
      channel: row.email ? 'email' : 'sms',
      sessionHandle: session.sessionHandle,
    },
  });

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
