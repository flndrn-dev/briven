/**
 * FDI request lock — project + pk_briven_auth_ required.
 *
 * SuperTokens-style: end-user recipes are still "public" to the app, but the
 * app proves itself with a publishable auth key bound to one project. No
 * unauthenticated internet spam of passwordless / OAuth / passkeys.
 */

import type { Context } from 'hono';

import { env } from '../../env.js';
import { resolveAuthSdkKey } from '../auth-sdk-keys.js';
import { isBrivenEngineAuthEnabled } from './workspace.js';
import { mapProjectToAuthCore } from './project-map.js';
import {
  getBrivenEngineMethodFlags,
  type BrivenEngineMethodFlags,
} from './project-config.js';

export type FdiProjectContext = {
  projectId: string;
  tenantId: string;
  keyId: string;
  scope: string;
  methods: BrivenEngineMethodFlags;
};

function projectIdFromHeaders(c: Context): string | null {
  const raw =
    c.req.header('x-briven-project-id') ??
    c.req.header('x-project-id') ??
    c.req.header('briven-project-id') ??
    // GET authorisationurl from <a href> cannot set headers — allow query.
    c.req.query('briven_project_id') ??
    c.req.query('projectId');
  const id = raw?.trim() ?? '';
  if (!id.startsWith('p_')) return null;
  return id;
}

function bearerToken(c: Context): string | null {
  const auth = c.req.header('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice('bearer '.length).trim();
  return token || null;
}

/**
 * Hosted Briven Auth UI (briven.tech/auth/…) is first-party IdP login.
 * SuperTokens-style: the IdP host is trusted; third-party apps still need pk.
 * Pure helper — unit-tested.
 */
export function isHostedPlatformOrigin(
  originHeader: string | null | undefined,
  refererHeader: string | null | undefined,
  webOrigin: string,
): boolean {
  const allowed = webOrigin.replace(/\/$/, '').toLowerCase();
  if (!allowed) return false;
  const candidates: string[] = [];
  if (originHeader?.trim()) candidates.push(originHeader.trim());
  if (refererHeader?.trim()) {
    try {
      candidates.push(new URL(refererHeader.trim()).origin);
    } catch {
      /* ignore bad referer */
    }
  }
  return candidates.some((c) => c.replace(/\/$/, '').toLowerCase() === allowed);
}

function deny(
  c: Context,
  status: 401 | 403 | 400,
  body: Record<string, unknown>,
): Response {
  return c.json(
    {
      engine: 'briven-engine',
      storage: 'doltgres',
      ...body,
    },
    status,
  );
}

/**
 * Resolve and authorize FDI project context.
 * Returns a Response on failure (caller must return it).
 */
export async function requireFdiProjectKey(
  c: Context,
): Promise<FdiProjectContext | Response> {
  const projectId = projectIdFromHeaders(c);
  if (!projectId) {
    return deny(c, 401, {
      status: 'UNAUTHORIZED',
      code: 'project_required',
      message:
        'x-briven-project-id header required (project public auth is scoped per project)',
    });
  }

  const token = bearerToken(c);
  const hosted = isHostedPlatformOrigin(
    c.req.header('origin'),
    c.req.header('referer'),
    env.BRIVEN_WEB_ORIGIN,
  );

  // Third-party apps: require pk_briven_auth_. Hosted IdP pages on briven.tech
  // may omit the browser key (still project-scoped + Auth-enabled).
  let keyId = 'hosted_platform';
  let scope = 'read-write';

  if (token && token.startsWith('pk_briven_auth_')) {
    let resolved: Awaited<ReturnType<typeof resolveAuthSdkKey>>;
    try {
      resolved = await resolveAuthSdkKey(token);
    } catch {
      resolved = null;
    }
    if (!resolved) {
      return deny(c, 401, {
        status: 'UNAUTHORIZED',
        code: 'invalid_auth_key',
        message: 'invalid or revoked Auth public key',
      });
    }
    if (resolved.projectId !== projectId) {
      return deny(c, 403, {
        status: 'FORBIDDEN',
        code: 'project_key_mismatch',
        message: 'Auth public key does not belong to this project',
      });
    }
    const method = c.req.method.toUpperCase();
    if (
      resolved.scope === 'read' &&
      method !== 'GET' &&
      method !== 'HEAD' &&
      method !== 'OPTIONS'
    ) {
      return deny(c, 403, {
        status: 'FORBIDDEN',
        code: 'key_scope_readonly',
        message: 'this Auth key is read-only; mint a read-write key for sign-in',
      });
    }
    keyId = resolved.keyId;
    scope = resolved.scope;
  } else if (!hosted) {
    return deny(c, 401, {
      status: 'UNAUTHORIZED',
      code: 'auth_key_required',
      message:
        'Authorization: Bearer pk_briven_auth_… required for Auth end-user APIs',
    });
  }

  const enabled = await isBrivenEngineAuthEnabled(projectId);
  if (!enabled) {
    return deny(c, 403, {
      status: 'AUTH_DISABLED',
      code: 'auth_disabled',
      message: 'Auth is disabled for this project',
    });
  }

  let map: ReturnType<typeof mapProjectToAuthCore>;
  try {
    map = mapProjectToAuthCore(projectId);
  } catch {
    return deny(c, 400, {
      status: 'BAD_REQUEST',
      code: 'invalid_project',
      message: 'invalid project id',
    });
  }

  const methods = await getBrivenEngineMethodFlags(projectId);
  return {
    projectId: map.projectId,
    tenantId: map.tenantId,
    keyId,
    scope,
    methods,
  };
}

/** Recipe method flags for a specific flow. */
export function methodFlagDenied(
  methods: BrivenEngineMethodFlags,
  recipe:
    | 'emailPassword'
    | 'passwordlessEmail'
    | 'magicLink'
    | 'passwordlessSms'
    | 'passkeys'
    | 'mfa',
): string | null {
  if (recipe === 'emailPassword' && !methods.emailPassword) {
    return 'email/password sign-in is disabled for this project';
  }
  if (recipe === 'passwordlessEmail' && !methods.passwordlessEmail) {
    return 'email OTP is disabled for this project';
  }
  if (recipe === 'magicLink' && !methods.magicLink) {
    return 'magic link is disabled for this project';
  }
  if (recipe === 'passwordlessSms' && !methods.passwordlessSms) {
    return 'SMS OTP is disabled for this project';
  }
  if (recipe === 'passkeys' && !methods.passkeys) {
    return 'passkeys are disabled for this project';
  }
  if (recipe === 'mfa' && !methods.mfa) {
    // MFA flag false means "not required / not offered as product toggle"
    // Setup can still work if user enrolled — only block verify enroll paths if needed.
    // For login second-factor we still allow if user has TOTP enrolled (security).
    return null;
  }
  return null;
}

/** Production must never fall back to shared `public` tenant. */
export function requireTenantId(
  projectId: string | undefined,
  tenantId: string | undefined,
): { ok: true; tenantId: string } | { ok: false; message: string } {
  if (tenantId) return { ok: true, tenantId };
  if (projectId) {
    try {
      return { ok: true, tenantId: mapProjectToAuthCore(projectId).tenantId };
    } catch {
      return { ok: false, message: 'invalid project id' };
    }
  }
  if (env.BRIVEN_ENV === 'production') {
    return {
      ok: false,
      message: 'project id required (shared public tenant disabled in production)',
    };
  }
  return { ok: true, tenantId: 'public' };
}
