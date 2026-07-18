/**
 * Sprint S4 — pure security helpers (unit-testable without DNS/Redis/DB).
 *
 * Domain TXT match, open-redirect RelayState checks, SDK key method scopes.
 */

/** Preferred DNS TXT payload for org domain ownership. */
export function domainVerificationTxt(token: string): string {
  return `briven-domain-verification=${token}`;
}

/**
 * True if any DNS TXT record proves ownership of `token`.
 * Accepts either the raw token or the preferred `briven-domain-verification=` form.
 */
export function txtRecordsContainDomainToken(
  txtRecords: string[][],
  token: string,
): boolean {
  if (!token) return false;
  const preferred = domainVerificationTxt(token);
  return txtRecords.some((chunks) => {
    const joined = chunks.join('');
    return joined.includes(preferred) || joined.includes(token);
  });
}

/**
 * Validate a post-SSO redirect target against an allowlist of origins.
 * Relative paths `/...` are allowed. Absolute URLs must match an origin.
 * Protocol-relative `//evil.com` and non-http(s) schemes are rejected.
 */
export function sanitizeRelayState(
  relayState: string | null | undefined,
  allowedOrigins: readonly string[],
): string {
  if (!relayState || relayState === '/') return '/';
  // Relative path only (not protocol-relative).
  if (relayState.startsWith('/') && !relayState.startsWith('//')) {
    return relayState;
  }
  try {
    const url = new URL(relayState);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '/';
    }
    const origin = `${url.protocol}//${url.host}`;
    const allowed = allowedOrigins
      .filter(Boolean)
      .map((a) => a.toLowerCase());
    if (allowed.includes(origin.toLowerCase())) {
      return relayState;
    }
  } catch {
    // invalid URL
  }
  return '/';
}

export type AuthSdkKeyScope = 'read' | 'read-write' | 'admin';

/**
 * Whether an SDK key scope may call this HTTP method on the auth-tenant bridge.
 * `read` = safe methods only. `read-write` and `admin` = all methods.
 */
export function sdkKeyAllowsMethod(scope: AuthSdkKeyScope | string, method: string): boolean {
  const m = method.toUpperCase();
  if (scope === 'read') {
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
  }
  if (scope === 'read-write' || scope === 'admin') {
    return true;
  }
  return false;
}
