/**
 * @briven/auth/engine — Briven Auth client for **briven-engine** (Path A).
 *
 * First-party proxy rule (required):
 *   Browser → https://YOUR_APP/api/auth/*  →  https://api.briven.tech/v1/auth-core/fdi/*
 * so session cookies sit on the app domain.
 *
 *   import { createBrivenEngineClient } from '@briven/auth/engine';
 *
 *   const auth = createBrivenEngineClient({
 *     projectId: 'p_abc',
 *     // Prefer same-origin proxy path in the browser:
 *     apiBasePath: '/api/auth',
 *   });
 *
 * Product brand: briven-engine only.
 */

export const BRIVEN_ENGINE_ID = 'briven-engine' as const;

export type BrivenEngineClientOptions = {
  readonly projectId: string;
  /**
   * Base path for FDI calls. Default `/api/auth` (first-party proxy on app).
   * For direct API (server-side only / local): full origin + `/v1/auth-core/fdi`.
   */
  readonly apiBasePath?: string;
  /** Absolute API origin when not using same-origin proxy. */
  readonly apiOrigin?: string;
  readonly fetch?: typeof globalThis.fetch;
};

export type BrivenEngineSession = {
  readonly userId: string;
  readonly sessionHandle?: string;
  readonly accessTokenPayload?: Record<string, unknown>;
};

export type BrivenEngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

export type BrivenEngineClient = {
  readonly engine: typeof BRIVEN_ENGINE_ID;
  readonly projectId: string;
  /** Session recipe: refresh */
  refreshSession: () => Promise<BrivenEngineResult<unknown>>;
  /** Session recipe: sign out */
  signOut: () => Promise<BrivenEngineResult<unknown>>;
  /** EmailPassword sign up */
  signUpEmailPassword: (input: {
    email: string;
    password: string;
  }) => Promise<BrivenEngineResult<unknown>>;
  /** EmailPassword sign in */
  signInEmailPassword: (input: {
    email: string;
    password: string;
  }) => Promise<BrivenEngineResult<unknown>>;
  /** Passwordless: create code (email or phone — SMS included) */
  createPasswordlessCode: (input: {
    email?: string;
    phoneNumber?: string;
  }) => Promise<BrivenEngineResult<unknown>>;
  /** Passwordless: consume user input code */
  consumePasswordlessCode: (input: {
    preAuthSessionId: string;
    userInputCode: string;
    deviceId: string;
  }) => Promise<BrivenEngineResult<unknown>>;
  /** Raw FDI helper */
  fdi: (path: string, init?: RequestInit) => Promise<Response>;
};

function joinBase(apiOrigin: string | undefined, apiBasePath: string): string {
  const path = apiBasePath.replace(/\/$/, '') || '/api/auth';
  if (!apiOrigin) return path;
  return `${apiOrigin.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export function createBrivenEngineClient(
  opts: BrivenEngineClientOptions,
): BrivenEngineClient {
  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const base = joinBase(
    opts.apiOrigin,
    opts.apiBasePath ?? '/api/auth',
  );

  async function fdi(path: string, init?: RequestInit): Promise<Response> {
    const p = path.startsWith('/') ? path : `/${path}`;
    const headers = new Headers(init?.headers);
    headers.set('x-briven-project-id', opts.projectId);
    headers.set('x-briven-engine', BRIVEN_ENGINE_ID);
    if (!headers.has('content-type') && init?.body) {
      headers.set('content-type', 'application/json');
    }
    return fetchFn(`${base}${p}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  }

  async function jsonResult(res: Response): Promise<BrivenEngineResult<unknown>> {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg =
        data && typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message: unknown }).message)
          : res.statusText;
      return { ok: false, status: res.status, message: msg };
    }
    return { ok: true, data };
  }

  return {
    engine: BRIVEN_ENGINE_ID,
    projectId: opts.projectId,
    fdi,
    refreshSession: async () => {
      const res = await fdi('/session/refresh', { method: 'POST', body: '{}' });
      return jsonResult(res);
    },
    signOut: async () => {
      const res = await fdi('/signout', { method: 'POST', body: '{}' });
      return jsonResult(res);
    },
    signUpEmailPassword: async ({ email, password }) => {
      const res = await fdi('/signup', {
        method: 'POST',
        body: JSON.stringify({
          formFields: [
            { id: 'email', value: email },
            { id: 'password', value: password },
          ],
        }),
        headers: { rid: 'emailpassword' },
      });
      return jsonResult(res);
    },
    signInEmailPassword: async ({ email, password }) => {
      const res = await fdi('/signin', {
        method: 'POST',
        body: JSON.stringify({
          formFields: [
            { id: 'email', value: email },
            { id: 'password', value: password },
          ],
        }),
        headers: { rid: 'emailpassword' },
      });
      return jsonResult(res);
    },
    createPasswordlessCode: async (input) => {
      const body: Record<string, string> = {};
      if (input.email) body.email = input.email;
      if (input.phoneNumber) body.phoneNumber = input.phoneNumber;
      const res = await fdi('/signinup/code', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { rid: 'passwordless' },
      });
      return jsonResult(res);
    },
    consumePasswordlessCode: async (input) => {
      const res = await fdi('/signinup/code/consume', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { rid: 'passwordless' },
      });
      return jsonResult(res);
    },
  };
}

/** Next.js (or any) first-party proxy target for briven-engine FDI. */
export function brivenEngineProxyTarget(apiOrigin?: string): string {
  const origin = (apiOrigin ?? 'https://api.briven.tech').replace(/\/$/, '');
  return `${origin}/v1/auth-core/fdi`;
}

export { BRIVEN_ENGINE_SCAFFOLDS, listBrivenEngineScaffolds } from './scaffolds.js';
export {
  proxyBrivenEngineAuth,
  brivenEngineNextHandler,
  appAuthPathToFdiSuffix,
  resolveFdiTarget,
} from './proxy.js';
export type { BrivenEngineProxyOptions } from './proxy.js';
// Server session helper: import from '@briven/auth/engine/server'
