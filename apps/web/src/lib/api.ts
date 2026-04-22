import { cookies, headers } from 'next/headers';

import { apiOrigin } from './env';

/**
 * Server-side fetch against apps/api. Forwards the incoming request's cookies
 * so Better Auth session cookies set on the api origin carry through.
 *
 * Only call from server components / route handlers.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const incoming = await headers();
  const forwarded = incoming.get('x-forwarded-for') ?? incoming.get('x-real-ip');

  const res = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      cookie: cookieHeader,
      ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
      accept: 'application/json',
    },
    cache: 'no-store',
  });
  return res;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || res.statusText);
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
