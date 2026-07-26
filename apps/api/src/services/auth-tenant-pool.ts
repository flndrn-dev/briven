import { randomBytes } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, genericOAuth, jwt, magicLink, twoFactor } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { authSchema } from '../db/auth-customer-schema.js';
import { dbNameFor } from '../db/data-plane.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { getRequestContext } from '../lib/request-context.js';
import { captureSignupGeo } from './signup-geo.js';
import {
  checkEmailGate,
  getUserSecurityState,
  isUserBlocked,
} from './auth-security.js';
import { runInProjectDatabase } from '../db/data-plane.js';
import {
  sendBrivenAuthEmailVerification,
  sendBrivenAuthMagicLink,
  sendBrivenAuthOtp,
  sendBrivenAuthPasswordReset,
} from './auth-mailer.js';
import { ensureTenantAuthSchema } from './auth-provisioning.js';
import { brivenOwnOrigins, originsForProject } from './auth-origin-allowlist.js';
import { publishEvent, type AuthEventType } from './outbound-webhooks.js';
import { getTenantSecret } from './tenant-secrets.js';
import { maybeAutoLinkOAuthAccount } from './auth-account-linking.js';
import { maybeAlertNewDevice } from './auth-device-tracking.js';
import { mustChangePassword } from './auth-password-policy.js';
import {
  computeEnabledProviders,
  DEFAULT_AUTH_CONFIG,
  getAuthConfig,
  type AuthConfig,
} from './tenant-config-store.js';
import { TenantInstancePool } from './tenant-instance-pool.js';

/**
 * Per-tenant Better Auth instance pool — the briven auth-specific factory
 * that wires `TenantInstancePool` + Drizzle + Better Auth into a working
 * customer-facing instance per project.
 *
 * Lifecycle (ARCHITECTURE.md §3):
 *   - first `getAuthInstance(projectId)` lazily creates the pool
 *   - cache miss opens a per-project `pg` pool bound to the project's own
 *     DoltGres DATABASE (`proj_<id>`), wraps it in a Drizzle client, and
 *     constructs a `betterAuth({...})` instance
 *   - cache hit returns the warm instance
 *   - eviction (idle, LRU, or forced) closes the per-project pool via
 *     `closePool()` so connections are released
 *
 * Tenancy: database-per-project (ADR 0001). The auth tables live in the
 * project's own database `public` schema, so binding the pool to that
 * database is enough — no `search_path` pinning, and no schema-per-project.
 * Uses `pg` (node-postgres), not postgres.js, which desyncs with DoltGres.
 *
 * v0 provider configuration: email + password only. OAuth providers,
 * magic link, OTP, and passkeys land in the next step once the per-tenant
 * config storage + mittera mailer wiring are in place (BUILD_PLAN.md
 * §13 step 4).
 */

/**
 * Type inferred from the factory's return rather than declared explicitly.
 * Better Auth's `Auth<TOptions>` is invariant in its generic parameter, so
 * a hand-written `ReturnType<typeof betterAuth>` widens to
 * `Auth<BetterAuthOptions>` and refuses assignment from the narrow
 * inferred type of our specific call. Letting TypeScript derive the
 * type keeps the precise inference all the way through the pool.
 */
export type BrivenAuthInstance = Awaited<ReturnType<typeof createAuthInstance>>;

let pool: TenantInstancePool<BrivenAuthInstance> | null = null;
let processSecret: string | null = null;

/**
 * In-memory map for OAuth auto-linking (Gap Fix #4).
 * When `user.create.after` detects a duplicate email and moves the
 * OAuth account to an existing user, it stores the mapping here so
 * that the subsequent `session.create.before` hook can redirect the
 * session to the correct (existing) user id.
 * Entries are consumed (deleted) on first read in session.create.before.
 */
const oauthLinkMap = new Map<string, string>();

/**
 * Resolve the Better Auth signing secret. Same fallback chain as the
 * control-plane auth (`apps/api/src/lib/auth.ts`): real env value in
 * prod, ephemeral per-process in dev.
 */
function authSecret(): string {
  if (env.BRIVEN_BETTER_AUTH_SECRET) return env.BRIVEN_BETTER_AUTH_SECRET;
  if (env.BRIVEN_ENV !== 'development') {
    throw new Error(
      'BRIVEN_BETTER_AUTH_SECRET is required outside development for briven auth',
    );
  }
  if (!processSecret) {
    processSecret = randomBytes(32).toString('hex');
    log.warn('briven_auth_ephemeral_secret', {
      reason: 'dev-only fallback — sessions will not survive restart',
    });
  }
  return processSecret;
}

// ─── hosted-pages URL helpers ────────────────────────────────────────────

/**
 * First-party proxy path on the **customer app** that forwards to
 * `/v1/auth-tenant/*` (see `briven auth scaffold` + Konnos).
 * Magic-link verify must open here so the browser shows the project host
 * (valid cert on their domain) and the session cookie can be first-party.
 */
export const APP_AUTH_PROXY_PREFIX = '/api/auth/v1/auth-tenant';

/**
 * Base URL used for **hosted pages** (reset password UI) and as last-resort
 * fallback when no app origin is known.
 *
 * - Custom domain (customer owns DNS+TLS): `https://auth.their.app`
 * - Magic-link / email-verify **action** links prefer the app origin via
 *   `rewriteAuthActionUrlToApp` — not this host (users must not land on a
 *   bare api.briven.tech JSON page).
 * - Fallback: API origin (valid public cert).
 */
export function hostedAuthBaseUrl(
  projectId: string,
  config?: { customAuthDomain?: string | null },
): string {
  if (config?.customAuthDomain) {
    return `https://${config.customAuthDomain}`;
  }
  // projectId reserved for future path-style hosted pages if needed
  void projectId;
  return env.BRIVEN_API_ORIGIN;
}

function isLocalhostOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost');
  } catch {
    return false;
  }
}

/**
 * Pick the best absolute https origin for email click-through links.
 * Prefer callbackURL's origin (where the user asked to land), else the first
 * non-localhost allowed app domain, else null (caller falls back).
 */
export function resolveAppOriginForAuthEmail(
  callbackOrAbsoluteUrl: string | null | undefined,
  projectOrigins: string[],
): string | null {
  if (callbackOrAbsoluteUrl) {
    try {
      const u = new URL(callbackOrAbsoluteUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        // Prefer real public host over localhost when a prod origin is registered
        if (!isLocalhostOrigin(u.origin)) return u.origin;
      }
    } catch {
      // ignore
    }
  }
  for (const raw of projectOrigins) {
    try {
      const normalised = raw.replace('://*.', '://');
      const o = new URL(normalised).origin;
      if (!isLocalhostOrigin(o) && (o.startsWith('https:') || o.startsWith('http:'))) {
        return o;
      }
    } catch {
      // skip
    }
  }
  // Last resort among allowlist: localhost (dev)
  for (const raw of projectOrigins) {
    try {
      const o = new URL(raw.replace('://*.', '://')).origin;
      if (isLocalhostOrigin(o)) return o;
    } catch {
      // skip
    }
  }
  if (callbackOrAbsoluteUrl) {
    try {
      const u = new URL(callbackOrAbsoluteUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Rewrite Better Auth action URLs (magic-link verify, email verify) so the
 * email link opens on the **customer project host**, not api.briven.tech.
 *
 * Shape:
 *   https://pay.example.com/api/auth/v1/auth-tenant/magic-link/verify?token=…&callbackURL=…&briven_project_id=…
 *
 * The app must proxy `/api/auth/v1/auth-tenant/*` → api (scaffold + Konnos).
 * Without a proxy the click 404s — still better than a dead API landing page
 * if the app follows the one-path setup. Fallback: customAuthDomain, then API.
 */
export function rewriteAuthActionUrlToApp(
  url: string,
  projectId: string,
  config?: { customAuthDomain?: string | null },
  projectOrigins: string[] = [],
): string {
  try {
    const original = new URL(url);
    const callback = original.searchParams.get('callbackURL');
    const appOrigin = resolveAppOriginForAuthEmail(callback, projectOrigins);

    if (appOrigin) {
      // /v1/auth-tenant/magic-link/verify → /api/auth/v1/auth-tenant/magic-link/verify
      let suffix = original.pathname;
      const marker = '/v1/auth-tenant';
      const idx = suffix.indexOf(marker);
      if (idx >= 0) {
        suffix = suffix.slice(idx + marker.length) || '/';
      }
      if (!suffix.startsWith('/')) suffix = `/${suffix}`;
      const path = `${APP_AUTH_PROXY_PREFIX}${suffix}`;
      return new URL(path + original.search, appOrigin).toString();
    }

    if (config?.customAuthDomain) {
      return rewriteToHostedUrl(url, projectId, config);
    }
    // No app origin registered yet — keep API host (valid TLS) rather than
    // broken *.auth.briven.tech. Still tag tenant for resolveTenant.
    return rewriteToHostedUrl(url, projectId, config);
  } catch {
    return url;
  }
}

/**
 * The hosted "choose a new password" link Better Auth emails on a reset.
 * Contract (pinned by auth-tenant-pool-plugins.test.ts):
 *   <hostedAuthBaseUrl>/auth/<projectId>/new-password?token=<token>
 * The token is URL-encoded so reserved characters survive the query string.
 */
export function resetPasswordUrl(
  projectId: string,
  token: string,
  config?: { customAuthDomain?: string | null },
): string {
  return `${hostedAuthBaseUrl(projectId, config)}/auth/${projectId}/new-password?token=${encodeURIComponent(token)}`;
}

// ─── config-driven plugin loading ────────────────────────────────────────

/**
 * Minimal structural shape of a Better Auth plugin — every plugin exposes a
 * stable string `id`. We only need the `id` for the config-gating contract +
 * the plugins array, so this narrow local type keeps the return precise
 * without importing Better Auth's internal `BetterAuthPlugin` type (which is
 * invariant and fights assignment across the version boundary, same reason
 * `BrivenAuthInstance` is inferred rather than declared).
 */
type TenantAuthPlugin = { id: string } & Record<string, unknown>;

/**
 * Tag a Better-Auth-generated action URL with the tenant id so a plain browser
 * navigation (an email-link click) can still resolve the tenant. Better Auth
 * builds these links from `baseURL` (api.briven.tech) with no per-tenant marker,
 * and a link click — unlike the SDK — cannot attach the `x-briven-project-id`
 * header that the `/v1/auth-tenant/*` bridge normally reads. So we stamp
 * `briven_project_id` into the query string; `resolveTenant` (auth-service.ts)
 * reads it as the header's fallback. The id (`p_…`) is a PUBLIC identifier, never
 * a secret — the one-time token in the same link stays the actual credential —
 * so it is safe to place in a URL.
 */
export function tagTenantUrl(url: string, projectId: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('briven_project_id', projectId);
    return u.toString();
  } catch {
    // Not an absolute URL (should never happen for a Better Auth link) — leave it.
    return url;
  }
}

/**
 * Rewrite a Better-Auth-generated URL from the API origin to the project's
 * hosted auth base URL. This makes magic-link verify links, email-verification
 * links, and OAuth callbacks land on the customer's auth subdomain
 * (e.g. auth.murphus.eu) instead of api.briven.tech.
 */
export function rewriteToHostedUrl(
  url: string,
  projectId: string,
  config?: { customAuthDomain?: string | null },
): string {
  try {
    const original = new URL(url);
    const base = new URL(hostedAuthBaseUrl(projectId, config));
    const rewritten = new URL(original.pathname + original.search, base);
    return rewritten.toString();
  } catch {
    return url;
  }
}

/**
 * Strip the "auth." prefix from a custom auth subdomain to get the parent
 * domain for cookie scoping. auth.murphus.eu → murphus.eu.
 * Returns null if the domain does not start with "auth.".
 */
function parentDomainFromAuthSubdomain(domain: string): string | undefined {
  if (domain.toLowerCase().startsWith('auth.')) {
    return domain.slice(5);
  }
  return undefined;
}

/**
 * Approximate the registrable domain (eTLD+1) for WebAuthn rpID.
 * WebAuthn requires rpID to be a suffix of the page host — e.g. for
 * `code.konnos.org` the rpID must be `konnos.org` or `code.konnos.org`,
 * NEVER `briven.tech` (browsers reject that as a security error).
 *
 * Not a full Public Suffix List: last-two labels for normal TLDs, last-three
 * for a small set of multi-part TLDs (co.uk, com.au, …). Good enough for
 * customer app domains on the allowlist.
 */
export function registrableDomainFromHost(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/^\*\./, '');
  if (!h || h.includes('..') || h.startsWith('.') || h.endsWith('.')) return null;
  if (h === 'localhost' || h.endsWith('.localhost')) return 'localhost';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h; // IPv4
  const parts = h.split('.').filter(Boolean);
  if (parts.length < 2) return h;
  const multiPartTlds = new Set([
    'co.uk',
    'org.uk',
    'ac.uk',
    'gov.uk',
    'com.au',
    'net.au',
    'org.au',
    'co.nz',
    'com.br',
    'co.jp',
    'com.mx',
    'co.za',
  ]);
  const last2 = parts.slice(-2).join('.');
  if (multiPartTlds.has(last2) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return last2;
}

/**
 * Pick the WebAuthn rpID for a tenant.
 *
 * Priority:
 *   1. customAuthDomain parent (auth.example.com → example.com)
 *   2. first non-localhost allowed app origin’s registrable domain
 *   3. briven.tech in production / localhost in dev (hosted apps only)
 */
export function resolvePasskeyRpId(
  config: { customAuthDomain?: string | null },
  projectOrigins: string[],
): string {
  const custom = config.customAuthDomain?.trim() || null;
  if (custom) {
    return parentDomainFromAuthSubdomain(custom) ?? custom;
  }

  const candidates: string[] = [];
  for (const raw of projectOrigins) {
    try {
      // wildcards stored as https://*.example.com
      const normalised = raw.replace('://*.', '://');
      const host = new URL(normalised).hostname;
      const reg = registrableDomainFromHost(host);
      if (reg && reg !== 'localhost') candidates.push(reg);
    } catch {
      // skip malformed
    }
  }

  // Prefer the customer's own domain over briven.tech if both appear.
  const nonBriven = candidates.find((d) => d !== 'briven.tech' && !d.endsWith('.briven.tech'));
  if (nonBriven) return nonBriven;
  if (candidates[0]) return candidates[0];

  return env.BRIVEN_ENV === 'production' ? 'briven.tech' : 'localhost';
}

/**
 * Build the per-tenant Better Auth plugins array from the project's stored
 * auth config. ONLY the passwordless methods the customer has toggled on are
 * loaded — so `POST /v1/auth-tenant/sign-in/magic-link` (and the OTP / passkey
 * routes) only register when the matching toggle is enabled. Social / OIDC
 * providers are handled separately by `buildGenericOAuthConfigs`.
 *
 * The mailer callbacks close over `projectId` so each tenant's emails render
 * with its own branding + sender domain (auth-mailer.ts resolves both).
 */
export function buildTenantAuthPlugins(
  projectId: string,
  config: AuthConfig,
  projectOrigins: string[] = [],
): TenantAuthPlugin[] {
  const plugins: TenantAuthPlugin[] = [];
  const p = config.providers;

  if (p.magicLink.enabled) {
    plugins.push(
      magicLink({
        expiresIn: p.magicLink.expiryMinutes * 60,
        sendMagicLink: async ({ email, url }) => {
          // Email must open on the **project URL** (via first-party proxy), not
          // a bare api.briven.tech page. Tenant id stays in the query string.
          const appUrl = rewriteAuthActionUrlToApp(url, projectId, config, projectOrigins);
          await sendBrivenAuthMagicLink(projectId, email, tagTenantUrl(appUrl, projectId));
        },
      }) as unknown as TenantAuthPlugin,
    );
  }

  if (p.emailOtp.enabled) {
    plugins.push(
      emailOTP({
        otpLength: p.emailOtp.codeLength,
        expiresIn: p.emailOtp.expiryMinutes * 60,
        sendVerificationOTP: async ({ email, otp }) => {
          await sendBrivenAuthOtp(projectId, email, otp);
        },
      }) as unknown as TenantAuthPlugin,
    );
  }

  if (p.passkey.enabled) {
    // rpID must be a registrable domain suffix of the page origin.
    // Derive from allowed app domains (e.g. code.konnos.org → konnos.org).
    // Hardcoding briven.tech broke every customer-domain passkey (browser
    // SecurityError: rpId is not a valid domain for this origin).
    // Do NOT pin `origin` on the plugin: verify uses the browser Origin header.
    const rpID = resolvePasskeyRpId(config, projectOrigins);
    plugins.push(
      passkey({
        rpID,
        rpName: config.branding.senderName,
      }) as unknown as TenantAuthPlugin,
    );
  }

  if (config.twoFactor.enabled) {
    plugins.push(
      twoFactor({
        issuer: config.twoFactor.issuer ?? 'Briven Auth',
        backupCodeOptions: {
          amount: 10,
        },
      }) as unknown as TenantAuthPlugin,
    );
  }

  return plugins;
}

/**
 * Compose the FINAL per-tenant plugins array: unconditional core plugins
 * first, then the config-gated ones. The jwt plugin is core — every project
 * gets `GET /v1/auth-tenant/token` (session → signed JWT) and
 * `GET /v1/auth-tenant/jwks` (public keys) with NO toggle, so backend
 * services can verify briven auth sessions statelessly. Options stay at the
 * plugin defaults on purpose: EdDSA/Ed25519 keys, 15-minute expiry, issuer +
 * audience = the auth baseURL origin, and the stored private key encrypted
 * with the instance secret (each tenant derives its own).
 *
 * Split out from `createAuthInstance` (which needs a live DB) so the
 * unconditional-core contract is unit-testable alongside the config gate.
 */
export function assembleTenantPlugins(
  passwordlessPlugins: TenantAuthPlugin[],
  genericOAuthConfigs: ReturnType<typeof buildGenericOAuthConfigs>,
  config: AuthConfig = DEFAULT_AUTH_CONFIG,
): TenantAuthPlugin[] {
  const jwtClaims = config.jwtClaims ?? {};
  return [
    jwt({
      jwt: {
        definePayload: (_session) => ({
          ...jwtClaims,
        }),
      },
    }) as unknown as TenantAuthPlugin,
    ...passwordlessPlugins,
    ...(genericOAuthConfigs.length > 0
      ? [genericOAuth({ config: genericOAuthConfigs as never }) as unknown as TenantAuthPlugin]
      : []),
  ];
}

// ─── lifecycle event → webhook dispatch ──────────────────────────────────

/**
 * Injected sink for auth lifecycle events. Kept as a plain function type so
 * `buildAuthDatabaseHooks` is pure + unit-testable (the test passes a
 * recording dispatcher); the pool wires the real webhook fan-out.
 */
export type AuthEventDispatcher = (
  projectId: string,
  eventType: string,
  payload: Record<string, unknown>,
) => void | Promise<void>;

/**
 * The production dispatcher: fan an auth lifecycle event out to the project's
 * outbound webhook subscribers. Failures are logged and swallowed — a webhook
 * hiccup must NEVER break the customer's login/signup flow (the sign-in still
 * succeeds; the event just doesn't fire).
 */
const dispatchAuthEvent: AuthEventDispatcher = async (projectId, eventType, payload) => {
  try {
    await publishEvent({ projectId, eventType: eventType as AuthEventType, payload });
  } catch (err) {
    log.warn('briven_auth_event_dispatch_failed', {
      projectId,
      eventType,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

/** Coerce a possible Date to an ISO string, else pass through / undefined. */
function isoOrUndefined(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return undefined;
}

/**
 * Check whether a user has enrolled any MFA method (TOTP or passkey).
 * Used by the MFA enforcement gate in session.create.before.
 */
async function userHasMfaEnrolled(projectId: string, userId: string): Promise<boolean> {
  const rows = await runInProjectDatabase<
    Array<{ totp_count: number; passkey_count: number }>
  >(projectId, async (tx) =>
    tx.unsafe(
      `SELECT
         (SELECT COUNT(*) FROM "_briven_auth_two_factors" WHERE user_id = $1) AS totp_count,
         (SELECT COUNT(*) FROM "_briven_auth_passkeys" WHERE user_id = $1) AS passkey_count`,
      [userId] as never,
    ) as never,
  );
  const row = rows[0];
  if (!row) return false;
  return row.totp_count > 0 || row.passkey_count > 0;
}

/**
 * Better Auth `databaseHooks` that fan lifecycle transitions out to the
 * injected dispatcher as `auth.*` webhook events. Payloads are deliberately
 * minimal — id/email/timestamps only — so no password hash or session token
 * ever rides the webhook (asserted by the test).
 *
 * Also enforces security policy: ban checks, MFA enforcement, and
 * email-gate defense-in-depth on user creation.
 */
export function buildAuthDatabaseHooks(
  projectId: string,
  dispatch: AuthEventDispatcher,
  config: AuthConfig = DEFAULT_AUTH_CONFIG,
) {
  return {
    user: {
      create: {
        before: async (user: { email: string }) => {
          // Defense-in-depth: re-validate email against allowlist/blocklist
          // even if the bridge already checked it. Catches OAuth sign-ups
          // where the email arrives from the provider.
          const gate = checkEmailGate(user.email, {
            allowedDomains: config.security.allowedEmailDomains,
            blockedDomains: config.security.blockedEmailDomains,
            blockDisposable: config.security.blockDisposableEmails,
            blockSubaddresses: config.security.blockEmailSubaddresses,
          });
          if (!gate.allowed) {
            throw new Error(gate.reason ?? 'sign-up not allowed');
          }
        },
        after: async (user: { id: string; email: string; createdAt?: unknown }) => {
          // Automatic OAuth account linking — if another user already exists
          // with the same email, move the OAuth account(s) to that user.
          // Must never break sign-up if the data plane is unavailable.
          let linkResult: { linkedToUserId: string } | null = null;
          try {
            linkResult = await maybeAutoLinkOAuthAccount(projectId, user.id, user.email);
          } catch (err) {
            log.warn('briven_auth_oauth_auto_link_failed', {
              projectId,
              userId: user.id,
              message: err instanceof Error ? err.message : String(err),
            });
          }
          if (linkResult) {
            // Stash the mapping so session.create.before can redirect the
            // session to the existing user.
            oauthLinkMap.set(user.id, linkResult.linkedToUserId);
          }

          // Control-plane sign-up geo capture (admin-only SEO analytics).
          // Fire-and-forget: captureSignupGeo swallows all its own errors, so
          // an unawaited promise can never reject or delay the auth response.
          // The IP rides an AsyncLocalStorage context set by the auth-tenant
          // bridge (routes/auth-service.ts) since this hook can't read the
          // HTTP request itself.
          void captureSignupGeo({
            projectId,
            userId: linkResult?.linkedToUserId ?? user.id,
            email: user.email,
            ip: getRequestContext()?.ip ?? null,
          });

          // Lazily create an empty metadata row for the new user so
          // getUserMetadata never returns null downstream.
          void runInProjectDatabase(projectId, async (tx) => {
            await tx.unsafe(
              `INSERT INTO "_briven_auth_user_metadata" (id, user_id, public_metadata, private_metadata, created_at, updated_at)
               VALUES (gen_random_uuid()::text, $1, '{}'::jsonb, '{}'::jsonb, now(), now())
               ON CONFLICT (user_id) DO NOTHING`,
              [linkResult?.linkedToUserId ?? user.id] as never,
            );
          }).catch(() => {
            // Swallow — metadata seeding must never break sign-up.
          });

          await dispatch(projectId, 'auth.signup', {
            userId: linkResult?.linkedToUserId ?? user.id,
            email: user.email,
            createdAt: isoOrUndefined(user.createdAt),
          });
        },
      },
    },
    session: {
      create: {
        before: async (session: { userId: string }) => {
          // Ban / suspension check. If the user is blocked, prevent session
          // creation so they cannot sign in even with valid credentials.
          const sec = await getUserSecurityState(projectId, session.userId);
          const blocked = isUserBlocked(sec);
          if (blocked.blocked) {
            throw new Error(blocked.reason ?? 'account access denied');
          }

          // Password expiry / admin force-reset (Sprint S3).
          try {
            const must = await mustChangePassword(projectId, session.userId);
            if (must.required) {
              throw new Error(must.reason ?? 'password change required');
            }
          } catch (err) {
            if (err instanceof Error && /password/i.test(err.message)) throw err;
            // Table missing / data-plane blip — do not brick sign-in.
          }

          // MFA enforcement. When twoFactor.required is true, every user
          // must have enrolled TOTP or registered a passkey before they
          // can create a session. Passkeys count as MFA (possession +
          // biometric), so passkey users bypass the TOTP challenge.
          if (config.twoFactor.required) {
            const hasMfa = await userHasMfaEnrolled(projectId, session.userId);
            if (!hasMfa) {
              throw new Error(
                'multi-factor authentication is required. please enroll a passkey or set up an authenticator app.',
              );
            }
          }

          // OAuth auto-link redirect: if this session is being created for a
          // user that was just auto-linked to an existing user, redirect the
          // session to the existing user id.
          const linkedUserId = oauthLinkMap.get(session.userId);
          if (linkedUserId) {
            session.userId = linkedUserId;
            oauthLinkMap.delete(session.userId);
          }
        },
        after: async (session: { id: string; userId: string; createdAt?: unknown }) => {
          // Track session activity for inactivity timeout.
          if (config.session.inactivityTimeoutMinutes > 0) {
            void runInProjectDatabase(projectId, async (tx) => {
              await tx.unsafe(
                `INSERT INTO "_briven_auth_session_activity" (id, session_id, last_active_at, created_at, updated_at)
                 VALUES (gen_random_uuid()::text, $1, now(), now(), now())
                 ON CONFLICT (session_id) DO UPDATE SET last_active_at = now(), updated_at = now()`,
                [session.id] as never,
              );
            }).catch(() => {
              // Swallow — activity tracking must never break sign-in.
            });
          }

          // Device tracking — alert on new device (fire-and-forget).
          const ctx = getRequestContext();
          if (ctx?.userAgent) {
            void runInProjectDatabase(projectId, async (tx) => {
              const rows = (await tx.unsafe(
                `SELECT email FROM "_briven_auth_users" WHERE id = $1 LIMIT 1`,
                [session.userId] as never,
              )) as Array<{ email: string }>;
              if (rows[0]) {
                await maybeAlertNewDevice(projectId, session.userId, rows[0].email, ctx.userAgent);
              }
            }).catch(() => {
              // Swallow — device tracking must never break sign-in.
            });
          }

          await dispatch(projectId, 'auth.signin', {
            sessionId: session.id,
            userId: session.userId,
            createdAt: isoOrUndefined(session.createdAt),
          });
        },
      },
      delete: {
        after: async (
          session: { id: string; userId: string },
          ctx?: { path?: string } | null,
        ) => {
          // Clean up session activity row when session is deleted.
          if (config.session.inactivityTimeoutMinutes > 0) {
            void runInProjectDatabase(projectId, async (tx) => {
              await tx.unsafe(
                `DELETE FROM "_briven_auth_session_activity" WHERE session_id = $1`,
                [session.id] as never,
              );
            }).catch(() => {
              // Swallow.
            });
          }

          // A user-initiated /sign-out vs an admin/self /revoke-session are
          // distinct events downstream; fall back to sign-out when Better
          // Auth gives no context path.
          const path = ctx?.path ?? '';
          const eventType = path.includes('revoke')
            ? 'auth.session.revoked'
            : 'auth.signout';
          await dispatch(projectId, eventType, {
            sessionId: session.id,
            userId: session.userId,
          });
        },
      },
    },
  };
}

// ─── social / custom-OIDC (genericOAuth) config building ──────────────────

/** The `<issuer>/.well-known/openid-configuration` discovery URL. */
function discoveryUrlFor(issuer: string): string {
  return `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
}

/**
 * A single Better Auth `genericOAuth` provider config entry. Structural shape
 * only — the real plugin validates the full option set.
 */
interface GenericOAuthEntry {
  providerId: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  pkce?: boolean;
  discoveryUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
}

/**
 * Resolved secrets for the OIDC/social providers, split so the pure gate
 * below stays sync + unit-testable: `konnos` is the konnos client secret (or
 * null), `oidc` maps each custom-OIDC slug → its client secret (or null).
 */
export interface OAuthSecretBundle {
  konnos: string | null;
  oidc: Record<string, string | null>;
}

/**
 * Build the `genericOAuth` `config` array from the tenant's auth config +
 * resolved secrets. Every entry passes the SAME gate the `listEnabledProviders`
 * signal uses: enabled + clientId + a stored secret (custom-OIDC additionally
 * needs an issuer OR all three explicit endpoints). konnos is emitted first so
 * our own product leads, then custom-OIDC in declaration order.
 *
 * Pure + secret-injected on purpose (the pool resolves the secrets, the test
 * passes a plain bundle) — no postgres, no crypto here.
 */
export function buildGenericOAuthConfigs(
  config: AuthConfig,
  secrets: OAuthSecretBundle,
): GenericOAuthEntry[] {
  const entries: GenericOAuthEntry[] = [];

  const konnos = config.providers.konnos;
  if (konnos.enabled && konnos.clientId && secrets.konnos) {
    // Git at code.konnos.org — OAuth endpoints, mirroring
    // the control-plane wiring in lib/auth.ts.
    const issuer = env.BRIVEN_KONNOS_ISSUER.replace(/\/$/, '');
    entries.push({
      providerId: 'konnos',
      clientId: konnos.clientId,
      clientSecret: secrets.konnos,
      authorizationUrl: `${issuer}/login/oauth/authorize`,
      tokenUrl: `${issuer}/login/oauth/access_token`,
      userInfoUrl: `${issuer}/api/v1/user`,
      scopes: ['read:user'],
    });
  }

  for (const o of config.customOidc ?? []) {
    const secret = secrets.oidc[o.id] ?? null;
    if (!o.enabled || !o.clientId || !secret) continue;
    const scopes = o.scopes.split(/\s+/).filter(Boolean);
    if (o.issuer) {
      entries.push({
        providerId: o.id,
        clientId: o.clientId,
        clientSecret: secret,
        scopes,
        pkce: o.pkce,
        discoveryUrl: discoveryUrlFor(o.issuer),
      });
    } else if (o.authorizationUrl && o.tokenUrl && o.userinfoUrl) {
      entries.push({
        providerId: o.id,
        clientId: o.clientId,
        clientSecret: secret,
        scopes,
        pkce: o.pkce,
        authorizationUrl: o.authorizationUrl,
        tokenUrl: o.tokenUrl,
        userInfoUrl: o.userinfoUrl,
      });
    }
    // else: no usable endpoint set — skip (matches oidcHasEndpoints gate).
  }

  return entries;
}

/**
 * Resolve the OAuth secret bundle for a project from the encrypted
 * control-plane store, probing ONLY the providers the config could enable.
 * Returns nulls for any absent secret so the gate can skip half-configured
 * providers. Secrets never touch logs — only their presence gates wiring.
 */
async function resolveOAuthSecrets(
  projectId: string,
  config: AuthConfig,
): Promise<OAuthSecretBundle> {
  const konnos =
    config.providers.konnos.enabled && config.providers.konnos.clientId
      ? await getTenantSecret(projectId, 'auth', 'konnos_client_secret')
      : null;
  const oidc: Record<string, string | null> = {};
  for (const o of config.customOidc ?? []) {
    oidc[o.id] =
      o.enabled && o.clientId
        ? await getTenantSecret(projectId, 'auth', `oidc_${o.id}_client_secret`)
        : null;
  }
  return { konnos, oidc };
}

/**
 * Resolve the enabled built-in social providers (google/github/discord/
 * microsoft) into Better Auth's `socialProviders` map. Uses the SAME
 * enabled-gate as the rest of the surface (`computeEnabledProviders`), then
 * decrypts only the secrets for providers that passed. konnos is intentionally
 * excluded here — it rides `genericOAuth`, not `socialProviders`.
 */
async function resolveSocialProviders(
  projectId: string,
  config: AuthConfig,
): Promise<Record<string, { clientId: string; clientSecret: string }>> {
  // Probe presence first (never decrypts) so the shared gate decides which
  // providers are live, then decrypt only the survivors.
  const builtins = [
    'google',
    'github',
    'discord',
    'microsoft',
    'apple',
    'twitter',
    'linkedin',
    'gitlab',
    'bitbucket',
    'dropbox',
    'facebook',
    'spotify',
  ] as const;
  const present = await Promise.all(
    builtins.map((k) => getTenantSecret(projectId, 'auth', `${k}_client_secret`)),
  );
  const secretByKey = new Map<string, string>();
  builtins.forEach((k, i) => {
    if (present[i]) secretByKey.set(`${k}_client_secret`, present[i]!);
  });
  const enabled = new Set(
    computeEnabledProviders(config, (name) => secretByKey.has(name)),
  );

  const out: Record<string, { clientId: string; clientSecret: string }> = {};
  for (const k of builtins) {
    const c = config.providers[k];
    const secret = secretByKey.get(`${k}_client_secret`);
    if (enabled.has(k) && c.clientId && secret) {
      out[k] = { clientId: c.clientId, clientSecret: secret };
    }
  }
  return out;
}

async function createAuthInstance(projectId: string) {
  if (!env.BRIVEN_DATA_PLANE_URL) {
    throw new Error('BRIVEN_DATA_PLANE_URL not configured — briven auth cannot bind a database');
  }

  // Per-project pg (node-postgres) pool bound to the project's OWN DoltGres
  // DATABASE (proj_<id>) — database-per-project, mirroring data-plane.ts and
  // apps/runtime/src/db.ts. Two reasons this replaced postgres.js + a
  // search_path schema (ADR 0001 / sprint S2.1):
  //   1. postgres.js's extended-protocol pipelining desyncs with DoltGres
  //      (`unhandled message "&{}"`); `pg` works reliably.
  //   2. The model is database-per-project, not schema-per-project, so the
  //      auth tables live in this database's `public` schema — no search_path
  //      pinning is needed (the connection is already bound to the right DB).
  const base = new URL(env.BRIVEN_DATA_PLANE_URL);
  const pgPool = new pg.Pool({
    host: base.hostname,
    port: Number(base.port || 5432),
    user: decodeURIComponent(base.username),
    password: decodeURIComponent(base.password),
    database: dbNameFor(projectId),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  const db = drizzle(pgPool);

  // This tenant trusts its own project's registered app domains (+ briven-own)
  // so the customer's login flow accepts requests from their website.
  const projectOrigins = await originsForProject(projectId);

  // Load the tenant's stored provider config and turn its toggles into the
  // actual Better Auth wiring: passwordless plugins (magic-link / OTP /
  // passkey), built-in social providers, and konnos/custom-OIDC via
  // genericOAuth. Without this the instance ignored the config and only ever
  // served email+password (the magic-link 404 bug).
  const config = await getAuthConfig(projectId);
  const passwordlessPlugins = buildTenantAuthPlugins(projectId, config, projectOrigins);
  const socialProviders = await resolveSocialProviders(projectId, config);
  const oauthSecrets = await resolveOAuthSecrets(projectId, config);
  const genericOAuthConfigs = buildGenericOAuthConfigs(config, oauthSecrets);
  const plugins = assembleTenantPlugins(passwordlessPlugins, genericOAuthConfigs, config);

  // Self-heal auth schema on projects provisioned BEFORE later DDL landed
  // (email templates, passkeys, two_factor column, jwks). Provisioning only
  // runs on first "Enable Auth", so live tenants never re-run the full batch.
  // Without this, magic-link / OTP 500 on missing tables/columns (Mavi 2026-07).
  // Failures are non-fatal so sign-in still attempts when heal partially fails.
  try {
    const heal = await ensureTenantAuthSchema(pgPool);
    if (heal.columnAdded) {
      log.info('briven_auth_schema_healed_column', {
        projectId,
        column: 'two_factor_enabled',
      });
    }
  } catch (err) {
    log.warn('briven_auth_schema_ensure_failed', {
      projectId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const instance = betterAuth({
    appName: `briven-auth-${projectId}`,
    secret: authSecret(),
    baseURL: env.BRIVEN_API_ORIGIN,
    // Distinct from control-plane Better Auth (which owns `/v1/auth/*`
    // for the briven.tech dashboard login). Customer-facing tenant auth
    // claims `/v1/auth-tenant/*` so the two engines don't collide in
    // Hono routing. SDK + hosted-pages both target this prefix.
    basePath: '/v1/auth-tenant',
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: authSchema.user,
        session: authSchema.session,
        account: authSchema.account,
        verification: authSchema.verification,
        // jwt-plugin key store — the plugin looks the model up as `jwks`.
        jwks: authSchema.jwks,
        // Phase 3 — MFA + Passkeys.
        twoFactor: authSchema.twoFactor,
        passkey: authSchema.passkey,
      },
    }),
    emailAndPassword: {
      // Driven by the tenant's config toggle. Defaults on for backward
      // compatibility (DEFAULT_AUTH_CONFIG has emailPassword.enabled = true),
      // so existing projects keep password login until they turn it off.
      enabled: config.providers.emailPassword.enabled,
      requireEmailVerification: env.BRIVEN_ENV === 'production',
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
      sendResetPassword: async ({ user, token }) => {
        // Route resets through the hosted "new-password" page (the SDK +
        // hosted-pages contract), not Better Auth's default API URL.
        await sendBrivenAuthPasswordReset(
          projectId,
          user.email,
          resetPasswordUrl(projectId, token, config),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: env.BRIVEN_ENV === 'production',
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const appUrl = rewriteAuthActionUrlToApp(url, projectId, config, projectOrigins);
        await sendBrivenAuthEmailVerification(
          projectId,
          user.email,
          tagTenantUrl(appUrl, projectId),
        );
      },
    },
    socialProviders,
    plugins,
    databaseHooks: buildAuthDatabaseHooks(projectId, dispatchAuthEvent, config) as never,
    session: {
      expiresIn: 60 * 60 * 24 * config.session.maxLifetimeDays,
      updateAge: 60 * 60 * 24 * config.session.updateAgeDays,
    },
    advanced: {
      cookiePrefix: 'briven-auth',
      useSecureCookies: env.BRIVEN_ENV === 'production',
      defaultCookieAttributes: {
        // Customer end-users log in from the customer's OWN domain, which is a
        // different site than api.briven.tech — a cross-site context. The
        // session cookie must therefore be SameSite=None in production so the
        // browser sends it on those cross-site requests. `useSecureCookies`
        // above is already true in prod, so the required `Secure` attribute is
        // set alongside it. Dev stays 'lax' (browsers reject SameSite=None
        // without Secure over http://localhost).
        sameSite: env.BRIVEN_ENV === 'production' ? 'none' : 'lax',
        httpOnly: true,
        // When a custom auth subdomain is configured (auth.murphus.eu), set the
        // cookie domain to the parent domain (murphus.eu) so the customer's
        // app on the root domain can read the session cookie.
        ...(config.customAuthDomain
          ? { domain: parentDomainFromAuthSubdomain(config.customAuthDomain) }
          : {}),
      },
      // Privacy (CLAUDE.md §5.1): never persist raw end-user IPs. The
      // session.ip_address column exists for Better-Auth compatibility but
      // stays null. (Add hashed-IP-on-write later if device tracking is wanted.)
      ipAddress: {
        disableIpTracking: true,
      },
    },
    trustedOrigins: [
      env.BRIVEN_API_ORIGIN,
      ...brivenOwnOrigins(),
      ...projectOrigins,
      ...(env.BRIVEN_ENV !== 'production'
        ? (['http://localhost:*', 'https://localhost:*', 'http://127.0.0.1:*', 'https://127.0.0.1:*'] as const)
        : []),
    ],
  });

  return {
    betterAuth: instance,
    closePool: async () => {
      await pgPool.end();
    },
  };
}

function getPool(): TenantInstancePool<BrivenAuthInstance> {
  if (!pool) {
    pool = new TenantInstancePool<BrivenAuthInstance>({
      maxSize: 256,
      idleTtlMs: 10 * 60 * 1000, // 10 minutes
      factory: createAuthInstance,
      onEvict: async (projectId, instance) => {
        await instance.closePool();
        log.info('briven_auth_instance_evicted', { projectId });
      },
      onEvictError: (projectId, err) => {
        log.warn('briven_auth_instance_evict_failed', {
          projectId,
          message: err instanceof Error ? err.message : String(err),
        });
      },
    });
  }
  return pool;
}

/**
 * Fetch (or create) the Better Auth instance for a project. Cached for
 * 10 minutes of idle time; LRU cap at 256 instances per api process.
 */
export function getAuthInstance(projectId: string): Promise<BrivenAuthInstance> {
  return getPool().get(projectId);
}

/**
 * Force-evict a project's instance. Called by the dashboard's
 * config-update handlers so the next request sees fresh state — e.g.
 * after a customer toggles an OAuth provider or rotates a webhook secret.
 */
export function invalidateAuthInstance(projectId: string): Promise<void> {
  if (!pool) return Promise.resolve();
  return pool.evict(projectId);
}

/**
 * Drop every cached instance. Test + graceful-shutdown hook.
 */
export async function clearAuthInstancePool(): Promise<void> {
  if (!pool) return;
  await pool.clear();
}

/**
 * Current pool size. Returns 0 before any tenant has been touched.
 */
export function authInstancePoolSize(): number {
  return pool?.size ?? 0;
}

/**
 * Visible for tests — replace the pool factory with a synthetic one so
 * test files can exercise the lifecycle without a real postgres + Better
 * Auth roundtrip.
 */
export function __unsafe_setAuthInstancePool_forTesting(
  next: TenantInstancePool<BrivenAuthInstance> | null,
): void {
  pool = next;
}
