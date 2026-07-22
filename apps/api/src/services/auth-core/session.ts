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

export async function verifyAuthCoreSession(opts: {
  url: string;
  method: string;
  headers: Headers;
  cookieHeader?: string;
}): Promise<VerifySessionResult> {
  if (!isAuthCoreInitialized()) {
    return { ok: false, reason: 'auth_core_sdk_not_ready', status: 503 };
  }
  const handle =
    opts.headers.get('x-briven-session-handle') ??
    opts.headers.get('st-auth-mode') ??
    null;
  // Cookie parse for sAccessToken is opaque; require handle header for now.
  if (!handle || handle === 'cookie') {
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
