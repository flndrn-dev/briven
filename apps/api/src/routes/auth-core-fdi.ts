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
import { env } from '../env.js';
import { requireTurnstileIfConfigured } from '../services/auth-core/abuse.js';
import { isAuthCoreInitialized } from '../services/auth-core/engine.js';
import { resolveAuthTenantFromHeaders } from '../services/auth-core/request-tenant.js';
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
  const result = await createPasswordlessCode({
    email: body.email,
    phoneNumber: body.phoneNumber,
    projectId: tenant?.projectId,
    tenantId: tenant?.tenantId,
    flowType: body.flowType,
    magicLinkBaseUrl: body.magicLinkBaseUrl,
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

/** Social: get Google/GitHub authorisation URL */
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
    return c.json(result, result.status === 'NO_CREDENTIALS' ? 400 : 400);
  }
  return c.json(result);
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
    if (result.status !== 'OK') return c.json(result, 400);
    c.header(
      'Set-Cookie',
      `sAccessToken=${result.session.accessToken}; Path=/; HttpOnly; SameSite=Lax`,
      { append: true },
    );
    return c.json({
      status: 'OK',
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
  if (result.status !== 'OK') return c.json(result, 400);
  c.header(
    'Set-Cookie',
    `sAccessToken=${result.session.accessToken}; Path=/; HttpOnly; SameSite=Lax`,
    { append: true },
  );
  return c.json({
    status: 'OK',
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

authCoreFdiRouter.all(`${FDI}/*`, async (c) => {
  if (!isAuthCoreInitialized()) return c.json(notReady(), 503);
  return c.json(
    {
      code: 'auth_core_fdi_partial',
      engine: 'briven-engine',
      storage: 'doltgres',
      message:
        'Path not implemented yet. Working: EP, passwordless, social authorisationurl/signinup.',
      path: c.req.path,
    },
    404,
  );
});
