/**
 * briven-engine FDI-compatible routes — implemented on Doltgres only.
 * No SuperTokens Core process.
 *
 * Public end-user endpoints (apps proxy here first-party).
 */

import { Hono } from 'hono';

import {
  signInEmailPassword,
  signUpEmailPassword,
} from '../services/auth-core/emailpassword.js';
import {
  createEngineSession,
  revokeEngineSession,
} from '../services/auth-core/native-session.js';
import {
  consumePasswordlessCode,
  createPasswordlessCode,
} from '../services/auth-core/passwordless.js';
import {
  getAuthorisationUrl,
  signInUpWithCode,
  signInUpWithThirdPartyProfile,
  type SupportedSocial,
} from '../services/auth-core/thirdparty.js';
import {
  createTotpDevice,
  listTotpDevices,
  removeTotpDevice,
  userHasVerifiedTotp,
  verifyAndEnableTotpDevice,
  verifyUserTotp,
} from '../services/auth-core/mfa.js';
import {
  createAuthenticationOptions,
  createRegistrationOptions,
  deletePasskey,
  finishAuthentication,
  finishRegistration,
  listPasskeys,
} from '../services/auth-core/webauthn.js';
import { env } from '../env.js';
import { requireTurnstileIfConfigured } from '../services/auth-core/abuse.js';
import { isAuthCoreInitialized } from '../services/auth-core/engine.js';
import { resolveAuthTenantFromHeaders } from '../services/auth-core/request-tenant.js';
import { verifyAuthCoreSession } from '../services/auth-core/session.js';
import type { AppEnv } from '../types/app-env.js';

export const authCoreFdiRouter = new Hono<AppEnv>();

const FDI = '/v1/auth-core/fdi';

/** Cookie holds session handle (Doltgres lookup key). Secure in production. */
function setSessionCookies(
  c: { header: (n: string, v: string, o?: { append?: boolean }) => void },
  session: { sessionHandle: string; refreshToken: string; expiresAt: Date },
) {
  const secure = env.BRIVEN_ENV === 'production' ? '; Secure' : '';
  const maxAge = Math.max(
    60,
    Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
  );
  c.header(
    'Set-Cookie',
    `sAccessToken=${encodeURIComponent(session.sessionHandle)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
    { append: true },
  );
  c.header(
    'Set-Cookie',
    `sRefreshToken=${encodeURIComponent(session.refreshToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
    { append: true },
  );
}

async function captchaGate(
  body: Record<string, unknown>,
): Promise<Response | null> {
  const cap = await requireTurnstileIfConfigured(body);
  if (!cap.ok) {
    return new Response(
      JSON.stringify({
        status: 'CAPTCHA_ERROR',
        engine: 'briven-engine',
        message: cap.message,
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }
  return null;
}

function notReady() {
  return {
    code: 'auth_core_sdk_not_ready',
    engine: 'briven-engine',
    storage: 'doltgres',
    message: 'briven-engine not ready on Doltgres',
  };
}

authCoreFdiRouter.post(`${FDI}/signup`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const tenant = resolveAuthTenantFromHeaders((n) => c.req.header(n));
  let body: {
    formFields?: Array<{ id: string; value: string }>;
    email?: string;
    password?: string;
    turnstileToken?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const cap = await captchaGate(body as Record<string, unknown>);
  if (cap) return cap;
  const fields = Object.fromEntries(
    (body.formFields ?? []).map((f) => [f.id, f.value]),
  );
  const email = body.email ?? fields.email;
  const password = body.password ?? fields.password;
  if (!email || !password) {
    return c.json({ status: 'FIELD_ERROR', formFields: [] }, 400);
  }
  const result = await signUpEmailPassword({
    email,
    password,
    tenantId: tenant?.tenantId,
    projectId: tenant?.projectId,
  });
  if (result.status !== 'OK') {
    return c.json({ status: result.status });
  }
  const session = await createEngineSession({
    userId: result.user.id,
    tenantId: result.user.tenantId,
  });
  // Phase 2: cookie value = session handle (lookup key on Doltgres).
  setSessionCookies(c, session);
  c.header('x-briven-engine', 'briven-engine');
  c.header('x-briven-session-handle', session.sessionHandle);
  if (tenant) c.header('x-briven-tenant-id', tenant.tenantId);
  return c.json({
    status: 'OK',
    user: { id: result.user.id, emails: [result.user.email] },
    session: {
      handle: session.sessionHandle,
      userId: session.userId,
    },
    engine: 'briven-engine',
    storage: 'doltgres',
  });
});

authCoreFdiRouter.post(`${FDI}/signin`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const tenant = resolveAuthTenantFromHeaders((n) => c.req.header(n));
  let body: {
    formFields?: Array<{ id: string; value: string }>;
    email?: string;
    password?: string;
    turnstileToken?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const cap = await captchaGate(body as Record<string, unknown>);
  if (cap) return cap;
  const fields = Object.fromEntries(
    (body.formFields ?? []).map((f) => [f.id, f.value]),
  );
  const email = body.email ?? fields.email;
  const password = body.password ?? fields.password;
  if (!email || !password) {
    return c.json({ status: 'FIELD_ERROR' }, 400);
  }
  const result = await signInEmailPassword({
    email,
    password,
    tenantId: tenant?.tenantId,
    projectId: tenant?.projectId,
  });
  if (result.status !== 'OK') {
    return c.json({ status: result.status });
  }
  // Phase 5: if TOTP enrolled, require second factor before issuing session.
  if (await userHasVerifiedTotp(result.user.id)) {
    return c.json({
      status: 'MFA_REQUIRED',
      factor: 'totp',
      userId: result.user.id,
      tenantId: result.user.tenantId,
      engine: 'briven-engine',
      storage: 'doltgres',
      message: 'password ok — send TOTP code to /v1/auth-core/fdi/totp/verify',
    });
  }
  const session = await createEngineSession({
    userId: result.user.id,
    tenantId: result.user.tenantId,
  });
  setSessionCookies(c, session);
  c.header('x-briven-engine', 'briven-engine');
  c.header('x-briven-session-handle', session.sessionHandle);
  return c.json({
    status: 'OK',
    user: { id: result.user.id, emails: [result.user.email] },
    session: { handle: session.sessionHandle, userId: session.userId },
    engine: 'briven-engine',
    storage: 'doltgres',
  });
});

authCoreFdiRouter.post(`${FDI}/signout`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const handle =
    c.req.header('x-briven-session-handle') ??
    (() => {
      const cookie = c.req.header('cookie') ?? '';
      const m = /(?:^|;\s*)sAccessToken=([^;]+)/.exec(cookie);
      return m?.[1] ? decodeURIComponent(m[1]) : undefined;
    })();
  if (handle) await revokeEngineSession(handle);
  c.header(
    'Set-Cookie',
    'sAccessToken=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    { append: true },
  );
  c.header(
    'Set-Cookie',
    'sRefreshToken=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    { append: true },
  );
  return c.json({ status: 'OK', engine: 'briven-engine' });
});

/** Passwordless: create email/SMS code (magic link + OTP). Phase 3. */
authCoreFdiRouter.post(`${FDI}/signinup/code`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const tenant = resolveAuthTenantFromHeaders((n) => c.req.header(n));
  let body: {
    email?: string;
    phoneNumber?: string;
    flowType?: 'USER_INPUT_CODE' | 'MAGIC_LINK' | 'USER_INPUT_CODE_AND_MAGIC_LINK';
    magicLinkBaseUrl?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const requestOrigin =
    c.req.header('origin') ??
    (() => {
      const ref = c.req.header('referer');
      if (!ref) return undefined;
      try {
        return new URL(ref).origin;
      } catch {
        return undefined;
      }
    })() ??
    undefined;
  const clientIp =
    c.req.header('cf-connecting-ip')?.trim() ||
    c.req.header('x-real-ip')?.trim() ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    null;
  const userAgent = c.req.header('user-agent') ?? null;
  const result = await createPasswordlessCode({
    email: body.email,
    phoneNumber: body.phoneNumber,
    projectId: tenant?.projectId,
    tenantId: tenant?.tenantId,
    flowType: body.flowType,
    magicLinkBaseUrl: body.magicLinkBaseUrl,
    requestOrigin,
    clientIp,
    userAgent,
  });
  if (result.status !== 'OK') {
    return c.json({ ...result, engine: 'briven-engine' }, 400);
  }
  return c.json({
    status: 'OK',
    engine: 'briven-engine',
    storage: 'doltgres',
    preAuthSessionId: result.preAuthSessionId,
    deviceId: result.deviceId,
    flowType: result.flowType,
    channel: result.channel,
    // Dev-only fields stripped in production inside service
    userInputCode: result.userInputCode,
    linkCode: result.linkCode,
    delivery: result.delivery,
  });
});

/** Passwordless: consume OTP or magic link. Phase 3. */
authCoreFdiRouter.post(`${FDI}/signinup/code/consume`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const tenant = resolveAuthTenantFromHeaders((n) => c.req.header(n));
  let body: {
    preAuthSessionId?: string;
    deviceId?: string;
    userInputCode?: string;
    linkCode?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.preAuthSessionId || !body.deviceId) {
    return c.json(
      {
        status: 'BAD_REQUEST',
        message: 'preAuthSessionId and deviceId required',
        engine: 'briven-engine',
      },
      400,
    );
  }
  const result = await consumePasswordlessCode({
    preAuthSessionId: body.preAuthSessionId,
    deviceId: body.deviceId,
    userInputCode: body.userInputCode,
    linkCode: body.linkCode,
    projectId: tenant?.projectId,
    tenantId: tenant?.tenantId,
  });
  if (result.status !== 'OK') {
    return c.json(
      { ...result, engine: 'briven-engine' },
      result.status === 'EXPIRED' ? 401 : 400,
    );
  }
  // accessToken === session handle (Phase 2 cookie contract)
  setSessionCookies(c, {
    sessionHandle: result.session.handle,
    refreshToken: result.session.refreshToken,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  c.header('x-briven-engine', 'briven-engine');
  c.header('x-briven-session-handle', result.session.handle);
  return c.json({
    status: 'OK',
    engine: 'briven-engine',
    storage: 'doltgres',
    createdNewUser: result.createdNewUser,
    user: result.user,
    session: { handle: result.session.handle, userId: result.session.userId },
  });
});

/** Social: get Google/GitHub authorisation URL (Phase 4). */
authCoreFdiRouter.get(`${FDI}/authorisationurl`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const tenant = resolveAuthTenantFromHeaders((n) => c.req.header(n));
  const thirdPartyId = (c.req.query('thirdPartyId') ?? '') as SupportedSocial;
  const redirectURI = c.req.query('redirectURI') ?? '';
  const result = await getAuthorisationUrl({
    thirdPartyId,
    redirectURI,
    projectId: tenant?.projectId ?? c.req.query('projectId') ?? undefined,
  });
  if (result.status !== 'OK') {
    return c.json({ ...result, engine: 'briven-engine' }, 400);
  }
  return c.json({ ...result, engine: 'briven-engine', storage: 'doltgres' });
});

/** Social: complete sign-in with OAuth authorization code */
authCoreFdiRouter.post(`${FDI}/signinup`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const tenant = resolveAuthTenantFromHeaders((n) => c.req.header(n));
  let body: {
    thirdPartyId?: SupportedSocial;
    redirectURI?: string;
    code?: string;
    state?: string;
    /** Dev-only synthetic profile (step 3 local proof) */
    testProfile?: {
      thirdPartyUserId: string;
      email?: string;
      emailVerified?: boolean;
      name?: string;
    };
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  // Development-only: skip real provider when testProfile supplied
  if (
    body.testProfile &&
    body.thirdPartyId &&
    env.BRIVEN_ENV !== 'production'
  ) {
    const result = await signInUpWithThirdPartyProfile({
      profile: {
        thirdPartyId: body.thirdPartyId,
        thirdPartyUserId: body.testProfile.thirdPartyUserId,
        email: body.testProfile.email ?? null,
        emailVerified: body.testProfile.emailVerified ?? true,
        name: body.testProfile.name ?? null,
      },
      projectId: tenant?.projectId,
      tenantId: tenant?.tenantId,
    });
    if (result.status !== 'OK') {
      return c.json({ ...result, engine: 'briven-engine' }, 400);
    }
    setSessionCookies(c, {
      sessionHandle: result.session.handle,
      refreshToken: result.session.refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    c.header('x-briven-engine', 'briven-engine');
    c.header('x-briven-session-handle', result.session.handle);
    return c.json({
      status: 'OK',
      engine: 'briven-engine',
      storage: 'doltgres',
      createdNewUser: result.createdNewUser,
      user: result.user,
      session: { handle: result.session.handle, userId: result.session.userId },
      mode: 'test_profile',
    });
  }

  if (!body.thirdPartyId || !body.code || !body.redirectURI) {
    return c.json(
      {
        status: 'BAD_REQUEST',
        engine: 'briven-engine',
        message: 'thirdPartyId, code, redirectURI required (or testProfile in dev)',
      },
      400,
    );
  }

  const result = await signInUpWithCode({
    thirdPartyId: body.thirdPartyId,
    code: body.code,
    redirectURI: body.redirectURI,
    projectId: tenant?.projectId,
    state: body.state,
  });
  if (result.status !== 'OK') {
    return c.json({ ...result, engine: 'briven-engine' }, 400);
  }
  setSessionCookies(c, {
    sessionHandle: result.session.handle,
    refreshToken: result.session.refreshToken,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  c.header('x-briven-engine', 'briven-engine');
  c.header('x-briven-session-handle', result.session.handle);
  return c.json({
    status: 'OK',
    engine: 'briven-engine',
    storage: 'doltgres',
    createdNewUser: result.createdNewUser,
    user: result.user,
    session: { handle: result.session.handle, userId: result.session.userId },
  });
});

authCoreFdiRouter.post(`${FDI}/session/refresh`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  // Minimal: client should re-signin if session expired; full refresh later.
  return c.json({ status: 'UNAUTHORISED' }, 401);
});

// ─── Phase 5: TOTP MFA ───────────────────────────────────────────────

async function sessionUserId(c: {
  req: { header: (n: string) => string | undefined; raw: { headers: Headers } };
}): Promise<string | null> {
  const result = await verifyAuthCoreSession({
    url: 'http://local/session',
    method: 'GET',
    headers: c.req.raw.headers,
    cookieHeader: c.req.header('cookie'),
  });
  if (!result.ok) return null;
  return result.session.getUserId();
}

/** Enroll TOTP (needs existing session). */
authCoreFdiRouter.post(`${FDI}/totp/setup`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const tenant = resolveAuthTenantFromHeaders((n) => c.req.header(n));
  const userId = await sessionUserId(c);
  if (!userId) {
    return c.json(
      { status: 'UNAUTHORISED', engine: 'briven-engine', message: 'session required' },
      401,
    );
  }
  let body: { deviceName?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const created = await createTotpDevice(userId, body.deviceName ?? 'authenticator', {
    projectId: tenant?.projectId,
    tenantId: tenant?.tenantId,
  });
  if (!created.ok) {
    return c.json({ status: 'ERROR', ...created }, 400);
  }
  return c.json({
    status: 'OK',
    engine: 'briven-engine',
    storage: 'doltgres',
    deviceId: created.deviceId,
    deviceName: created.deviceName,
    secret: created.secret,
    otpauthUrl: created.otpauthUrl,
  });
});

/** Confirm enroll with first code from authenticator app. */
authCoreFdiRouter.post(`${FDI}/totp/setup/verify`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const userId = await sessionUserId(c);
  if (!userId) {
    return c.json(
      { status: 'UNAUTHORISED', engine: 'briven-engine', message: 'session required' },
      401,
    );
  }
  let body: { deviceId?: string; code?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.code) {
    return c.json({ status: 'BAD_REQUEST', message: 'code required' }, 400);
  }
  const v = await verifyAndEnableTotpDevice({
    userId,
    deviceId: body.deviceId,
    code: body.code,
  });
  if (!v.ok) {
    return c.json({ status: 'ERROR', engine: 'briven-engine', message: v.message }, 400);
  }
  return c.json({ status: 'OK', engine: 'briven-engine', storage: 'doltgres' });
});

/**
 * Second factor after password when MFA_REQUIRED.
 * Body: { userId, code, tenantId? }
 */
authCoreFdiRouter.post(`${FDI}/totp/verify`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const tenant = resolveAuthTenantFromHeaders((n) => c.req.header(n));
  let body: { userId?: string; code?: string; tenantId?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.userId || !body.code) {
    return c.json(
      { status: 'BAD_REQUEST', message: 'userId and code required' },
      400,
    );
  }
  const ok = await verifyUserTotp(body.userId, body.code);
  if (!ok.ok) {
    return c.json({ status: 'WRONG_CREDENTIALS_ERROR', engine: 'briven-engine' }, 401);
  }
  const tenantId = body.tenantId ?? tenant?.tenantId ?? 'public';
  const session = await createEngineSession({
    userId: body.userId,
    tenantId,
  });
  setSessionCookies(c, session);
  c.header('x-briven-engine', 'briven-engine');
  c.header('x-briven-session-handle', session.sessionHandle);
  return c.json({
    status: 'OK',
    engine: 'briven-engine',
    storage: 'doltgres',
    session: { handle: session.sessionHandle, userId: session.userId },
  });
});

authCoreFdiRouter.get(`${FDI}/totp/devices`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const userId = await sessionUserId(c);
  if (!userId) {
    return c.json({ status: 'UNAUTHORISED', engine: 'briven-engine' }, 401);
  }
  const list = await listTotpDevices(userId);
  return c.json({ status: 'OK', ...list });
});

authCoreFdiRouter.delete(`${FDI}/totp/devices/:deviceId`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const userId = await sessionUserId(c);
  if (!userId) {
    return c.json({ status: 'UNAUTHORISED', engine: 'briven-engine' }, 401);
  }
  const r = await removeTotpDevice(userId, c.req.param('deviceId'));
  return c.json({ status: r.ok ? 'OK' : 'ERROR', engine: 'briven-engine' }, r.ok ? 200 : 404);
});

// ─── Phase 5: Passkeys (WebAuthn) ────────────────────────────────────

authCoreFdiRouter.post(`${FDI}/webauthn/register/options`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const tenant = resolveAuthTenantFromHeaders((n) => c.req.header(n));
  const userId = await sessionUserId(c);
  if (!userId) {
    return c.json({ status: 'UNAUTHORISED', engine: 'briven-engine' }, 401);
  }
  let body: { userName?: string; rpId?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const result = await createRegistrationOptions({
    userId,
    userName: body.userName ?? userId,
    projectId: tenant?.projectId,
    tenantId: tenant?.tenantId,
    rpId: body.rpId,
  });
  if (result.status !== 'OK') {
    return c.json({ ...result, engine: 'briven-engine' }, 400);
  }
  return c.json({ ...result, engine: 'briven-engine', storage: 'doltgres' });
});

authCoreFdiRouter.post(`${FDI}/webauthn/register/finish`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const userId = await sessionUserId(c);
  if (!userId) {
    return c.json({ status: 'UNAUTHORISED', engine: 'briven-engine' }, 401);
  }
  let body: {
    challengeId?: string;
    credentialId?: string;
    publicKey?: string;
    transports?: string[];
    response?: unknown;
    rpId?: string;
    expectedOrigin?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.challengeId) {
    return c.json({ status: 'BAD_REQUEST', message: 'challengeId required' }, 400);
  }
  const result = await finishRegistration({
    userId,
    challengeId: body.challengeId,
    credentialId: body.credentialId,
    publicKey: body.publicKey,
    transports: body.transports,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response: body.response as any,
    rpId: body.rpId,
    expectedOrigin: body.expectedOrigin,
  });
  if (result.status !== 'OK') {
    return c.json({ ...result, engine: 'briven-engine' }, 400);
  }
  return c.json({ ...result, engine: 'briven-engine', storage: 'doltgres' });
});

authCoreFdiRouter.post(`${FDI}/webauthn/signin/options`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const tenant = resolveAuthTenantFromHeaders((n) => c.req.header(n));
  let body: { userId?: string; rpId?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const result = await createAuthenticationOptions({
    userId: body.userId,
    projectId: tenant?.projectId,
    tenantId: tenant?.tenantId,
    rpId: body.rpId,
  });
  if (result.status !== 'OK') {
    return c.json({ ...result, engine: 'briven-engine' }, 400);
  }
  return c.json({ ...result, engine: 'briven-engine', storage: 'doltgres' });
});

authCoreFdiRouter.post(`${FDI}/webauthn/signin/finish`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const tenant = resolveAuthTenantFromHeaders((n) => c.req.header(n));
  let body: {
    challengeId?: string;
    credentialId?: string;
    response?: unknown;
    rpId?: string;
    expectedOrigin?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.challengeId) {
    return c.json({ status: 'BAD_REQUEST', message: 'challengeId required' }, 400);
  }
  const result = await finishAuthentication({
    challengeId: body.challengeId,
    credentialId: body.credentialId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response: body.response as any,
    projectId: tenant?.projectId,
    rpId: body.rpId,
    expectedOrigin: body.expectedOrigin,
  });
  if (result.status !== 'OK') {
    return c.json({ ...result, engine: 'briven-engine' }, 400);
  }
  setSessionCookies(c, {
    sessionHandle: result.session.handle,
    refreshToken: result.session.refreshToken,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  c.header('x-briven-engine', 'briven-engine');
  c.header('x-briven-session-handle', result.session.handle);
  return c.json({
    status: 'OK',
    engine: 'briven-engine',
    storage: 'doltgres',
    verified: result.verified,
    userId: result.userId,
    session: { handle: result.session.handle, userId: result.session.userId },
  });
});

authCoreFdiRouter.get(`${FDI}/webauthn/credentials`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const userId = await sessionUserId(c);
  if (!userId) {
    return c.json({ status: 'UNAUTHORISED', engine: 'briven-engine' }, 401);
  }
  const list = await listPasskeys(userId);
  return c.json({ status: 'OK', ...list });
});

authCoreFdiRouter.delete(`${FDI}/webauthn/credentials/:id`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  const userId = await sessionUserId(c);
  if (!userId) {
    return c.json({ status: 'UNAUTHORISED', engine: 'briven-engine' }, 401);
  }
  const r = await deletePasskey(userId, c.req.param('id'));
  return c.json({ status: r.ok ? 'OK' : 'ERROR', engine: 'briven-engine' }, r.ok ? 200 : 404);
});

authCoreFdiRouter.all(`${FDI}/*`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  return c.json(
    {
      code: 'auth_core_fdi_partial',
      engine: 'briven-engine',
      storage: 'doltgres',
      message:
        'Path not implemented. Working: EP, passwordless, social, TOTP MFA, passkeys.',
      path: c.req.path,
    },
    404,
  );
});


