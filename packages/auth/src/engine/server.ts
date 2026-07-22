/**
 * @briven/auth/engine server helpers — briven-engine session on the server.
 *
 *   import { getBrivenEngineServerSession } from '@briven/auth/engine/server';
 */

import { BRIVEN_ENGINE_ID } from './index.js';

export type BrivenEngineServerSession =
  | {
      authenticated: true;
      userId: string;
      sessionHandle?: string;
      accessTokenPayload?: Record<string, unknown>;
      engine: typeof BRIVEN_ENGINE_ID;
    }
  | {
      authenticated: false;
      engine: typeof BRIVEN_ENGINE_ID;
    };

/**
 * Validate session cookie via Briven API briven-engine session endpoint.
 */
export async function getBrivenEngineServerSession(opts: {
  cookieHeader: string | null;
  apiOrigin?: string;
  projectId: string;
  fetch?: typeof globalThis.fetch;
}): Promise<BrivenEngineServerSession | null> {
  if (!opts.cookieHeader) return null;
  const origin = (opts.apiOrigin ?? 'https://api.briven.tech').replace(/\/$/, '');
  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  try {
    const res = await fetchFn(`${origin}/v1/auth-core/session/me`, {
      method: 'GET',
      headers: {
        cookie: opts.cookieHeader,
        'x-briven-project-id': opts.projectId,
        'x-briven-engine': BRIVEN_ENGINE_ID,
      },
    });
    if (!res.ok) {
      return { authenticated: false, engine: BRIVEN_ENGINE_ID };
    }
    const body = (await res.json()) as {
      authenticated?: boolean;
      userId?: string;
      sessionHandle?: string;
      accessTokenPayload?: Record<string, unknown>;
    };
    if (body.authenticated && body.userId) {
      return {
        authenticated: true,
        userId: body.userId,
        sessionHandle: body.sessionHandle,
        accessTokenPayload: body.accessTokenPayload,
        engine: BRIVEN_ENGINE_ID,
      };
    }
    return { authenticated: false, engine: BRIVEN_ENGINE_ID };
  } catch {
    return null;
  }
}
