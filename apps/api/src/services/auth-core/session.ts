/**
 * briven-engine session helpers (Doltgres-native).
 */

import {
  getSessionByHandle,
  listSessionHandles,
  revokeAllForUser,
  revokeEngineSession,
} from './native-session.js';
import { isAuthCoreInitialized } from './engine.js';

export type VerifySessionResult =
  | {
      ok: true;
      session: {
        getUserId: () => string;
        getHandle: () => string;
        getAccessTokenPayload: () => Record<string, unknown>;
      };
    }
  | { ok: false; reason: string; status?: number };

/**
 * Resolve session handle from headers/cookies (pure — unit-tested).
 * Phase 2: sAccessToken cookie value = session handle.
 */
export function extractSessionHandle(opts: {
  headers?: Headers | { get: (n: string) => string | null };
  cookieHeader?: string | null;
}): string | null {
  const get = (n: string) => opts.headers?.get(n) ?? null;
  let handle =
    get('x-briven-session-handle') ?? get('x-session-handle') ?? null;
  if (handle === 'cookie') handle = null;
  if (handle) return handle;
  const cookie = opts.cookieHeader ?? get('cookie') ?? '';
  const m =
    /(?:^|;\s*)sAccessToken=([^;]+)/.exec(cookie) ??
    /(?:^|;\s*)briven_session=([^;]+)/.exec(cookie);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export async function verifyAuthCoreSession(opts: {
  url: string;
  method: string;
  headers: Headers;
  cookieHeader?: string;
}): Promise<VerifySessionResult> {
  if (!isAuthCoreInitialized()) {
    return { ok: false, reason: 'auth_core_sdk_not_ready', status: 503 };
  }
  const handle = extractSessionHandle({
    headers: opts.headers,
    cookieHeader: opts.cookieHeader,
  });
  if (!handle) {
    return { ok: false, reason: 'no_session', status: 401 };
  }
  const row = await getSessionByHandle(handle);
  if (!row) return { ok: false, reason: 'invalid_session', status: 401 };
  return {
    ok: true,
    session: {
      getUserId: () => row.userId,
      getHandle: () => handle,
      getAccessTokenPayload: () => ({
        sub: row.userId,
        tenantId: row.tenantId,
      }),
    },
  };
}

export async function listSessionsForUser(userId: string): Promise<string[]> {
  if (!isAuthCoreInitialized()) return [];
  return listSessionHandles(userId);
}

export async function revokeSession(sessionHandle: string): Promise<boolean> {
  if (!isAuthCoreInitialized()) return false;
  return revokeEngineSession(sessionHandle);
}

export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  if (!isAuthCoreInitialized()) return 0;
  return revokeAllForUser(userId);
}
