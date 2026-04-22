import { redirect } from 'next/navigation';

import { ApiError, apiFetch } from './api';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
  isAdmin: boolean;
  suspendedAt: string | null;
  // EU KYC / billing profile (all optional until paid checkout).
  legalName: string | null;
  companyName: string | null;
  vatId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressRegion: string | null;
  addressCountry: string | null;
  createdAt: string;
  lastSignIn: {
    at: string;
    ipAddress: string | null;
    userAgent: string | null;
    nearBy: {
      city: string | null;
      region: string | null;
      country: string | null;
    } | null;
  } | null;
}

/**
 * Resolve the current session by calling apps/api's /v1/me. Returns null if
 * the caller is unauthenticated. Use `requireUser()` below for pages that
 * must redirect anonymous traffic to /signin.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const res = await apiFetch('/v1/me');
    if (res.status === 401) return null;
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return (await res.json()) as SessionUser;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function requireUser(redirectTo = '/signin'): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(redirectTo);
  return user;
}
