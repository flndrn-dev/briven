import { redirect } from 'next/navigation';

import { ApiUnavailableError, apiFetch } from './api';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
  isAdmin: boolean;
  // True when the user has an account password (Better Auth `credential`
  // account). Passwordless magic-link / OAuth users are false until they
  // set one in Settings → Security; the destructive-action step-up needs
  // a password to confirm against.
  hasPassword: boolean;
  // True when the user has set a "delete secret" — a separate credential
  // the api confirms destructive actions (e.g. project deletion) against.
  // Set in Settings → Security; the step-up prompt verifies against it.
  hasDeleteSecret: boolean;
  // ISO timestamp the delete secret was set, or null if none.
  deleteSecretSetAt: string | null;
  // Personal org id auto-created by migration 0010. Web uses this as the
  // implicit org context for every billing + project route; Phase 3 adds
  // an org switcher that overrides it.
  defaultOrgId: string;
  suspendedAt: string | null;
  // EU KYC / billing profile (all optional until paid checkout).
  legalName: string | null;
  companyName: string | null;
  companyRegistrationNumber: string | null;
  vatId: string | null;
  vatVerifiedAt: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressRegion: string | null;
  addressCountry: string | null;
  dateOfBirth: string | null;
  countryOfBirth: string | null;
  timezone: string | null;
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
  let res: Response;
  try {
    res = await apiFetch('/v1/me');
  } catch (err) {
    // Re-throw Next.js internal control-flow signals UNTOUCHED. `cookies()`
    // throws a DynamicServerError (digest 'DYNAMIC_SERVER_USAGE') during the
    // build's static-prerender pass to mark the route dynamic; redirect() and
    // notFound() throw similarly. They all carry a string `digest`. Wrapping
    // them as ApiUnavailableError breaks `next build` (it can't see the
    // signal) — which is exactly what failed the f502eb96 deploy.
    if (err && typeof err === 'object' && typeof (err as { digest?: unknown }).digest === 'string') {
      throw err;
    }
    // A genuine network-level failure (connection refused, DNS, timeout) —
    // almost always the brief window while a deploy restarts the api.
    throw new ApiUnavailableError(null, err instanceof Error ? err.message : 'network error');
  }
  // Real auth failure → treat as logged out so the caller redirects to sign-in.
  if (res.status === 401 || res.status === 403) return null;
  // Anything else non-OK (5xx, or the 404 window while a deploy swaps
  // containers) is transient backend-unavailability — surfaced as such so the
  // UI shows "reconnecting…" instead of a hard 500 / "something broke" page.
  if (!res.ok) {
    throw new ApiUnavailableError(res.status, `api responded ${res.status}`);
  }
  const user = (await res.json()) as Partial<SessionUser> & SessionUser;
  // Default the delete-secret fields if an older api build omits them.
  return {
    ...user,
    hasDeleteSecret: user.hasDeleteSecret ?? false,
    deleteSecretSetAt: user.deleteSecretSetAt ?? null,
  };
}

export async function requireUser(redirectTo = '/signin'): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(redirectTo);
  return user;
}
