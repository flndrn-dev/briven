/**
 * @briven/auth/server — Next.js App Router server helpers.
 *
 *   import { getServerSession } from '@briven/auth/server';
 *
 *   export default async function Page() {
 *     const session = await getServerSession(auth, {
 *       cookieHeader: (await cookies()).toString(),
 *     });
 *     if (!session?.authenticated) redirect('/sign-in');
 *     ...
 *   }
 *
 * Reads the `cookie` header off the incoming RSC request and forwards
 * it to the api. The api validates the session token (stored in the
 * cookie) and returns the user + session. Cookie names match Better
 * Auth defaults — the SDK never hard-codes them.
 *
 * Why not include `next` as a peer dep? `cookies()` from next/headers
 * is the cleanest way to read the cookie in App Router, but pulling
 * `next` into a published SDK risks version mismatches. Instead we
 * accept the cookie header as an opt-in argument so server-side
 * runtimes that expose `cookies()` (Next.js, Remix) can hand it over
 * without us depending on a specific framework.
 */

import type { BrivenAuthClient, SessionResponse, User } from '../index.js';

export interface ServerSessionInput {
  /** Raw `cookie` header from the incoming request. Required. */
  cookieHeader: string | null;
}

const BRIDGE_PREFIX = '/v1/auth-tenant';

/**
 * Validate the session cookie server-side. Returns `null` when there is
 * no cookie or the api is unreachable; returns `{ authenticated: false }`
 * when the cookie is present but the session is expired / revoked.
 */
export async function getServerSession(
  client: BrivenAuthClient,
  input: ServerSessionInput,
): Promise<SessionResponse | null> {
  if (!input.cookieHeader) return null;
  try {
    const res = await fetch(`${client.apiOrigin}${BRIDGE_PREFIX}/get-session`, {
      method: 'GET',
      headers: {
        cookie: input.cookieHeader,
        'x-briven-project-id': client.projectId,
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      user?: { id?: string };
      session?: { expiresAt?: string };
    } | null;
    if (body && body.user?.id && body.session?.expiresAt) {
      return {
        authenticated: true,
        userId: body.user.id,
        expiresAt: body.session.expiresAt,
      };
    }
    return { authenticated: false };
  } catch {
    return null;
  }
}

/**
 * Get the full user record server-side. Same lifecycle as
 * `getServerSession` — returns `null` on any failure path. Email + name
 * are present in the response; callers must honour the privacy boundary
 * (CLAUDE.md §5.1: email only visible to the account holder).
 */
export async function getServerUser(
  client: BrivenAuthClient,
  input: ServerSessionInput,
): Promise<User | null> {
  if (!input.cookieHeader) return null;
  try {
    const res = await fetch(`${client.apiOrigin}${BRIDGE_PREFIX}/get-session`, {
      method: 'GET',
      headers: {
        cookie: input.cookieHeader,
        'x-briven-project-id': client.projectId,
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: User } | null;
    return body?.user ?? null;
  } catch {
    return null;
  }
}

/**
 * Convenience wrapper. Throws when there is no session — callers redirect
 * inside the catch / fall-through path.
 *
 *   const session = await requireServerSession(auth, { cookieHeader });
 *   // guaranteed authenticated past this line
 */
export async function requireServerSession(
  client: BrivenAuthClient,
  input: ServerSessionInput,
): Promise<{ userId: string; expiresAt: string }> {
  const session = await getServerSession(client, input);
  if (!session || !session.authenticated) {
    throw new Error('briven-auth: unauthenticated');
  }
  return { userId: session.userId, expiresAt: session.expiresAt };
}

export type { BrivenAuthClient, SessionResponse, User };
