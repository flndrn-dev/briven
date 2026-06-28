import { redirect } from 'next/navigation';

import { ApiError, apiFetch } from './api';

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
  try {
    const res = await apiFetch('/v1/me');
    if (res.status === 401) return null;
    if (!res.ok) throw new ApiError(res.status, await res.text());
    const user = (await res.json()) as Partial<SessionUser> & SessionUser;
    // Default the delete-secret fields if an older api build omits them.
    return {
      ...user,
      hasDeleteSecret: user.hasDeleteSecret ?? false,
      deleteSecretSetAt: user.deleteSecretSetAt ?? null,
    };
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
