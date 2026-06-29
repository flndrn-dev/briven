import { randomBytes } from 'node:crypto';

import { passkey } from '@better-auth/passkey';
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, genericOAuth, magicLink } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { authSchema } from '../db/auth-customer-schema.js';
import { dbNameFor } from '../db/data-plane.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';
import {
  sendBrivenAuthEmailVerification,
  sendBrivenAuthMagicLink,
  sendBrivenAuthOtp,
  sendBrivenAuthPasswordReset,
} from './auth-mailer.js';
import { publishEvent, type AuthEventType } from './outbound-webhooks.js';
import { getAuthConfig, type AuthConfig } from './tenant-config-store.js';
import { getTenantSecret } from './tenant-secrets.js';
import { TenantInstancePool } from './tenant-instance-pool.js';

/** The element type of `genericOAuth({ config: [...] })` — one provider entry. */
type GenericOAuthEntry = Parameters<typeof genericOAuth>[0]['config'][number];

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
 * Provider configuration: email + password, plus per-tenant OAuth wired
 * from the project's config store + encrypted tenant-secret store
 * (google/github/discord/microsoft via Better Auth's socialProviders;
 * konnos via the genericOAuth plugin). Magic link + email OTP ride their
 * Better Auth plugins (gated per-tenant via config); both wire to the
 * existing branded mailer callbacks.
 *
 * PASSKEY (WebAuthn) — wired via the `@better-auth/passkey` plugin (matched
 * to better-auth@1.6.9). Gated per-tenant on `config.providers.passkey.enabled`
 * and bound to the hosted-pages relying-party identity (`passkeyRelyingParty`).
 * The plugin drives a 2-step ceremony: GET generate-(register|authenticate)-
 * options → POST verify-(registration|authentication).
 *
 * Outbound auth webhooks — Better Auth `databaseHooks` fan signup / signin /
 * signout / session-revoked lifecycle points out to customer webhook
 * subscribers via `publishEvent`. Dispatch is fire-and-forget and never
 * breaks the auth request (see `buildAuthDatabaseHooks`).
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

// ─── hosted-pages base URL + password-reset contract ────────────────────

/**
 * Base URL of a tenant's HOSTED auth pages — the Next.js `(hosted)` route
 * group at `apps/web/src/app/(hosted)/auth/[projectId]/[flow]`.
 *
 * Always the path-based `BRIVEN_WEB_ORIGIN` origin. The per-tenant
 * `<projectId>.auth.briven.tech` subdomain is NOT routed yet (deferred), so
 * EVERY hosted flow — the password-reset link AND the passkey WebAuthn
 * origin/rpID — must resolve to this single origin, which is also what the
 * hosted reset form uses as its `redirectTo` (`window.location.origin`). When
 * subdomain routing later lands this branches on env again — and the passkey
 * rpID migrates with it (security-critical, see `passkeyRelyingParty`).
 */
export function hostedAuthBaseUrl(_projectId: string): string {
  return env.BRIVEN_WEB_ORIGIN;
}

/**
 * CONTRACT with the hosted-pages builder (Phase 3 — password reset):
 *
 *   `${hostedAuthBaseUrl(projectId)}/auth/${projectId}/new-password?token=<token>`
 *
 * The `new-password` page reads `?token` and posts it to Better Auth's
 * reset-password endpoint under `/v1/auth-tenant`. We build the link off the
 * raw `token` (not Better Auth's default `url`) so it points at OUR hosted
 * page instead of the API's built-in redirect.
 */
export function resetPasswordUrl(projectId: string, token: string): string {
  return `${hostedAuthBaseUrl(projectId)}/auth/${projectId}/new-password?token=${encodeURIComponent(token)}`;
}

// ─── passkey relying-party (WebAuthn) — computed, plugin load BLOCKED ─────

/**
 * WebAuthn relying-party identity for a tenant's passkeys. The relying-party
 * ID (`rpID`) MUST be the registrable domain the hosted login page is served
 * from — the browser binds each passkey to it and it cannot be changed later
 * without invalidating every credential, so this is security-critical.
 *
 * Derived from `hostedAuthBaseUrl` so it ALWAYS tracks the origin the hosted
 * pages actually serve from (currently `BRIVEN_WEB_ORIGIN`'s host — `briven.tech`
 * in prod, `localhost` in dev — because the per-tenant `*.auth.briven.tech`
 * subdomain is deferred). The plugin's `expectedOrigin`/`expectedRPID` verify
 * against exactly this, so registration and authentication match what the
 * browser sees. `origin` is the full scheme+host.
 *
 * NEEDS HUMAN REVIEW: when the per-tenant subdomain routing lands, this rpID
 * changes and existing passkeys registered against the path-based host stop
 * working — plan a credential migration before flipping subdomains on.
 */
export function passkeyRelyingParty(projectId: string): {
  rpName: string;
  rpID: string;
  origin: string;
} {
  const origin = hostedAuthBaseUrl(projectId);
  const rpID = new URL(origin).hostname;
  return { rpName: 'briven auth', rpID, origin };
}

// ─── per-tenant plugin loader (magic link + email OTP) ───────────────────

/**
 * Build the per-tenant Better Auth plugins that are gated on the project's
 * auth config: magic-link and email-OTP sign-in. Both wire to the existing
 * branded mailer callbacks (auth-mailer.ts). Exported so the loader logic is
 * unit-testable without a real Better Auth + postgres roundtrip.
 *
 *   - magicLink → POST /v1/auth-tenant/sign-in/magic-link
 *   - emailOTP  → POST /v1/auth-tenant/sign-in/email-otp/send-verification-otp
 *                 + /v1/auth-tenant/sign-in/email-otp/verify
 *
 * Plugin import names confirmed against better-auth@1.6.9:
 *   `magicLink` and `emailOTP` (capital OTP) from `better-auth/plugins`.
 */
export function buildTenantAuthPlugins(
  projectId: string,
  config: AuthConfig,
): BetterAuthPlugin[] {
  const plugins: BetterAuthPlugin[] = [];

  if (config.providers.magicLink.enabled) {
    plugins.push(
      magicLink({
        expiresIn: config.providers.magicLink.expiryMinutes * 60,
        sendMagicLink: async ({ email, url }) => {
          await sendBrivenAuthMagicLink(projectId, email, url);
        },
      }),
    );
  }

  if (config.providers.emailOtp.enabled) {
    plugins.push(
      emailOTP({
        otpLength: config.providers.emailOtp.codeLength,
        expiresIn: config.providers.emailOtp.expiryMinutes * 60,
        // One branded OTP template serves every OTP type. In this config the
        // OTP flow is sign-in only (email-verification + password-reset keep
        // their link emails), so the "sign-in code" copy is always correct.
        sendVerificationOTP: async ({ email, otp }) => {
          await sendBrivenAuthOtp(projectId, email, otp);
        },
      }),
    );
  }

  if (config.providers.passkey.enabled) {
    // WebAuthn passkeys. rpName/rpID/origin are the relying-party identity the
    // browser binds each credential to, derived from the hosted-pages origin
    // (passkeyRelyingParty). The plugin exposes a 2-step ceremony:
    //   GET  /passkey/generate-register-options      → POST /passkey/verify-registration
    //   GET  /passkey/generate-authenticate-options  → POST /passkey/verify-authentication
    const { rpName, rpID, origin } = passkeyRelyingParty(projectId);
    plugins.push(passkey({ rpName, rpID, origin }));
  }

  return plugins;
}

// ─── generic OAuth wiring (konnos + custom OIDC) ─────────────────────────

/**
 * Decrypted client secrets for the `genericOAuth` providers. `konnos` is the
 * fixed built-in; `oidc` maps each custom-OIDC `id` to its secret (or null when
 * none is stored). Sourced by the caller from the encrypted tenant-secret store.
 */
export interface GenericOAuthSecrets {
  konnos: string | null;
  oidc: Record<string, string | null>;
}

/**
 * Build every `genericOAuth` provider entry for a tenant — konnos (our own
 * Forgejo, fixed gitea-compatible endpoints from env) PLUS one entry per
 * customer-defined custom-OIDC provider. Pure + exported so the wiring is
 * unit-testable without a live Better Auth + postgres.
 *
 * Each entry is gated EXACTLY like the built-in social providers:
 * `enabled && clientId && secret` — and custom-OIDC additionally needs a usable
 * endpoint set (an `issuer` for discovery, or all three explicit endpoints).
 * Anything short of that is silently skipped, so a half-configured provider
 * never reaches the engine.
 */
export function buildGenericOAuthConfigs(
  config: AuthConfig,
  secrets: GenericOAuthSecrets,
): GenericOAuthEntry[] {
  const entries: GenericOAuthEntry[] = [];

  // konnos (Forgejo at code.konnos.org) — gitea-compatible endpoints +
  // mapProfileToUser mirror lib/auth.ts exactly; only the credentials are
  // sourced per-tenant.
  const konnos = config.providers.konnos;
  if (konnos.enabled && konnos.clientId && secrets.konnos) {
    entries.push({
      providerId: 'konnos',
      clientId: konnos.clientId,
      clientSecret: secrets.konnos,
      authorizationUrl: `${env.BRIVEN_KONNOS_ISSUER}/login/oauth/authorize`,
      tokenUrl: `${env.BRIVEN_KONNOS_ISSUER}/login/oauth/access_token`,
      userInfoUrl: `${env.BRIVEN_KONNOS_ISSUER}/api/v1/user`,
      scopes: ['read:user'],
      mapProfileToUser: (profile) => ({
        id: String(profile.id),
        email: profile.email,
        name: profile.full_name || profile.login,
        image: profile.avatar_url,
        emailVerified: true,
      }),
    });
  }

  // Customer-defined generic OIDC providers. Either issuer-discovery or the
  // three explicit endpoints; scopes split off the space-separated config
  // string; PKCE defaults on (the OIDC-secure default), overridable per entry.
  for (const o of config.customOidc ?? []) {
    const secret = secrets.oidc[o.id] ?? null;
    const hasEndpoints = Boolean(o.authorizationUrl && o.tokenUrl && o.userinfoUrl);
    if (!o.enabled || !o.clientId || !secret) continue;
    if (!o.issuer && !hasEndpoints) continue;

    const scopes = o.scopes.split(/\s+/).filter(Boolean);
    const base = {
      providerId: o.id,
      clientId: o.clientId,
      clientSecret: secret,
      scopes,
      pkce: o.pkce ?? true,
    };
    if (o.issuer) {
      const issuer = o.issuer.replace(/\/+$/, '');
      entries.push({
        ...base,
        issuer,
        discoveryUrl: `${issuer}/.well-known/openid-configuration`,
      });
    } else {
      entries.push({
        ...base,
        authorizationUrl: o.authorizationUrl!,
        tokenUrl: o.tokenUrl!,
        userInfoUrl: o.userinfoUrl!,
      });
    }
  }

  return entries;
}

// ─── outbound auth webhook dispatch (lifecycle hooks) ────────────────────

/**
 * Injectable dispatcher so the lifecycle hooks can be unit-tested with a mock.
 * The production default (`defaultAuthEventDispatcher`) fans the event out to
 * customer webhook subscribers via `publishEvent`.
 */
export type AuthEventDispatcher = (
  projectId: string,
  eventType: AuthEventType,
  payload: Record<string, unknown>,
) => void;

/**
 * Production dispatcher. FIRE-AND-FORGET on purpose: a lifecycle hook runs
 * inside the auth request, and a slow or failing webhook enqueue must never
 * delay or break sign-up / sign-in. `publishEvent` only writes `pending`
 * delivery rows; the dispatcher worker does the real POST + retries.
 */
function defaultAuthEventDispatcher(
  projectId: string,
  eventType: AuthEventType,
  payload: Record<string, unknown>,
): void {
  void publishEvent({ projectId, eventType, payload }).catch((err) => {
    log.warn('briven_auth_webhook_dispatch_failed', {
      projectId,
      eventType,
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

function toIso(d: unknown): string | undefined {
  if (d instanceof Date) return d.toISOString();
  if (typeof d === 'string' || typeof d === 'number') {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString();
  }
  return undefined;
}

/**
 * Better Auth `databaseHooks` that fan authentication lifecycle events out to
 * customer outbound-webhook subscribers. Exported (with an injectable
 * `dispatch`) so the hook logic is unit-testable without a live Better Auth.
 *
 * Mapping:
 *   - user.create.after     → auth.signup
 *   - session.create.after  → auth.signin
 *   - session.delete.after  → auth.signout | auth.session.revoked
 *
 * Payloads are deliberately minimal + non-sensitive: ids, email, timestamps
 * only — never password hashes, session tokens, or raw IPs (CLAUDE.md §5.1).
 */
export function buildAuthDatabaseHooks(
  projectId: string,
  dispatch: AuthEventDispatcher = defaultAuthEventDispatcher,
): NonNullable<BetterAuthOptions['databaseHooks']> {
  return {
    user: {
      create: {
        after: async (user) => {
          dispatch(projectId, 'auth.signup', {
            userId: user.id,
            email: user.email,
            createdAt: toIso(user.createdAt),
          });
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          // A freshly-created session row means a successful sign-in.
          dispatch(projectId, 'auth.signin', {
            userId: session.userId,
            sessionId: session.id,
            createdAt: toIso(session.createdAt),
          });
        },
      },
      delete: {
        after: async (session, ctx) => {
          // Session deletion covers BOTH explicit sign-out and session
          // revocation; Better Auth routes them through different endpoints.
          // ASSUMPTION (needs review): sign-out hits `/sign-out`; revocation
          // hits a `/revoke-session(s)`-style path. Any path containing
          // "revoke" is treated as a revocation, everything else as sign-out.
          const path = ctx?.path ?? '';
          const eventType: AuthEventType = path.includes('revoke')
            ? 'auth.session.revoked'
            : 'auth.signout';
          dispatch(projectId, eventType, {
            userId: session.userId,
            sessionId: session.id,
          });
        },
      },
    },
  };
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

  // ── Per-tenant OAuth provider wiring ──────────────────────────────────
  // Source each provider's public config (enabled + clientId) from the
  // per-project config store, and the matching client SECRET from the
  // encrypted tenant-secret store (service 'auth', name
  // `<provider>_client_secret`). A provider only reaches the Better Auth
  // engine when ALL THREE are present — enabled, a clientId, AND a stored
  // secret — exactly mirroring the env-gated conditionals in the proven
  // control-plane auth (apps/api/src/lib/auth.ts), but with the values
  // sourced per-tenant instead of from env.
  const config = await getAuthConfig(projectId);

  // Load every provider's stored client secret up-front. A secret is only
  // fetched when the provider is enabled with a clientId, so a disabled
  // provider never touches the secret store.
  const secretFor = (
    provider: 'google' | 'github' | 'discord' | 'microsoft' | 'konnos',
  ): Promise<string | null> => {
    const p = config.providers[provider];
    return p.enabled && p.clientId
      ? getTenantSecret(projectId, 'auth', `${provider}_client_secret`)
      : Promise.resolve(null);
  };
  const [googleSecret, githubSecret, discordSecret, microsoftSecret, konnosSecret] =
    await Promise.all([
      secretFor('google'),
      secretFor('github'),
      secretFor('discord'),
      secretFor('microsoft'),
      secretFor('konnos'),
    ]);

  // Built-in social providers (google/github/discord/microsoft). Same
  // clientId/clientSecret shape Better Auth's `socialProviders` block uses
  // in lib/auth.ts; conditional spreads keep the precise per-key inference.
  const socialProviders = {
    ...(config.providers.google.enabled && config.providers.google.clientId && googleSecret
      ? { google: { clientId: config.providers.google.clientId, clientSecret: googleSecret } }
      : {}),
    ...(config.providers.github.enabled && config.providers.github.clientId && githubSecret
      ? { github: { clientId: config.providers.github.clientId, clientSecret: githubSecret } }
      : {}),
    ...(config.providers.discord.enabled && config.providers.discord.clientId && discordSecret
      ? { discord: { clientId: config.providers.discord.clientId, clientSecret: discordSecret } }
      : {}),
    ...(config.providers.microsoft.enabled &&
    config.providers.microsoft.clientId &&
    microsoftSecret
      ? {
          microsoft: {
            clientId: config.providers.microsoft.clientId,
            clientSecret: microsoftSecret,
          },
        }
      : {}),
  };

  // Generic OAuth providers ride the `genericOAuth` plugin (not on Better
  // Auth's built-in list): konnos (Forgejo at code.konnos.org) PLUS any
  // customer-defined custom-OIDC providers. Each custom-OIDC entry needs its
  // own decrypted secret (name `oidc_<id>_client_secret`), fetched only when the
  // entry is enabled with a clientId so a disabled one never touches the store.
  const customOidc = config.customOidc ?? [];
  const oidcSecretEntries = await Promise.all(
    customOidc.map(
      async (o) =>
        [
          o.id,
          o.enabled && o.clientId
            ? await getTenantSecret(projectId, 'auth', `oidc_${o.id}_client_secret`)
            : null,
        ] as const,
    ),
  );
  const genericOAuthConfigs = buildGenericOAuthConfigs(config, {
    konnos: konnosSecret,
    oidc: Object.fromEntries(oidcSecretEntries),
  });
  const genericOAuthPlugins =
    genericOAuthConfigs.length > 0 ? [genericOAuth({ config: genericOAuthConfigs })] : [];

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
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: env.BRIVEN_ENV === 'production',
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
      // Build the reset link off the raw `token` so it points at our HOSTED
      // new-password page (resetPasswordUrl contract) instead of Better Auth's
      // default API redirect URL.
      sendResetPassword: async ({ user, token }) => {
        await sendBrivenAuthPasswordReset(
          projectId,
          user.email,
          resetPasswordUrl(projectId, token),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: env.BRIVEN_ENV === 'production',
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendBrivenAuthEmailVerification(projectId, user.email, url);
      },
    },
    // Customer-configured OAuth. Built-in providers ride `socialProviders`;
    // konnos (generic OAuth) rides the genericOAuth plugin. Both are gated on
    // enabled + clientId + a stored secret above, so an empty object / empty
    // array here simply means "no OAuth configured for this tenant yet".
    socialProviders,
    // konnos + custom-OIDC (generic OAuth) + the per-tenant magic-link /
    // email-OTP plugins, each gated on the project's auth config.
    plugins: [...genericOAuthPlugins, ...buildTenantAuthPlugins(projectId, config)],
    // Fan signup / signin / signout / session-revoked out to customer webhook
    // subscribers. Dispatch is fire-and-forget and cannot break the request.
    databaseHooks: buildAuthDatabaseHooks(projectId),
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24 * 7, // refresh if older than 7 days
    },
    advanced: {
      cookiePrefix: 'briven-auth',
      useSecureCookies: env.BRIVEN_ENV === 'production',
      defaultCookieAttributes: {
        sameSite: 'lax',
        httpOnly: true,
      },
      // Privacy (CLAUDE.md §5.1): never persist raw end-user IPs. The
      // session.ip_address column exists for Better-Auth compatibility but
      // stays null. (Add hashed-IP-on-write later if device tracking is wanted.)
      ipAddress: {
        disableIpTracking: true,
      },
    },
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
