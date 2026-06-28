import { randomBytes } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth, magicLink } from 'better-auth/plugins';

import { getDb } from '../db/client.js';
import { accounts, sessions, users, verifications } from '../db/schema.js';
import { env } from '../env.js';
import { ensurePersonalOrg } from '../services/orgs.js';
import { log } from './logger.js';
import {
  sendEmailChangeConfirmation,
  sendEmailVerification,
  sendMagicLink,
  sendPasswordReset,
} from './email.js';

/**
 * Resolve the Better Auth signing secret. Refuses to boot in non-development
 * when BRIVEN_BETTER_AUTH_SECRET is unset — historically there was a
 * hardcoded literal fallback in this slot, which would let anyone reading
 * the open-core source forge sessions in a prod deploy that forgot the env
 * var. In dev we generate an ephemeral per-process value so dev workflows
 * keep working; sessions don't survive a restart.
 */
function resolveAuthSecret(): string {
  if (env.BRIVEN_BETTER_AUTH_SECRET) {
    return env.BRIVEN_BETTER_AUTH_SECRET;
  }
  if (env.BRIVEN_ENV === 'development') {
    log.warn(
      'BRIVEN_BETTER_AUTH_SECRET not set — using ephemeral per-process secret. Sessions will not survive restart.',
    );
    return randomBytes(32).toString('hex');
  }
  throw new Error(
    'BRIVEN_BETTER_AUTH_SECRET is required outside development. Set a value of at least 32 chars.',
  );
}

/**
 * Better Auth instance. Per BUILD_PLAN Phase 1 week 1-2 we wire all three
 * auth methods from day one: email + password, magic link via mittera.eu,
 * and Google OAuth — so j can sign into the dashboard on day one.
 *
 * All cookies are HTTP-only and SameSite=strict. Session TTL is 30 days; the
 * sliding-refresh refresh window is 7 days (session is extended on any
 * authenticated request inside that window).
 */
export const auth = betterAuth({
  appName: 'briven',
  secret: resolveAuthSecret(),
  baseURL: env.BRIVEN_API_ORIGIN,
  basePath: '/v1/auth',
  trustedOrigins: env.BRIVEN_TRUSTED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // Throttle credential-stuffing / brute-force against the auth endpoints
  // (sign-in, sign-up, password reset). Better Auth's built-in rate limiter
  // is window/max over each client IP. Enabled only in production so dev
  // and tests aren't throttled; ~10 requests per 60s window.
  rateLimit: {
    enabled: env.BRIVEN_ENV === 'production',
    window: 60,
    max: 10,
  },

  // Map Better Auth's singular model names onto our pluralised tables
  // (CLAUDE.md §6.1: DB tables are snake_case + plural).
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),

  advanced: {
    cookiePrefix: 'briven',
    useSecureCookies: env.BRIVEN_ENV === 'production',
    // Cross-subdomain cookie: `.<BRIVEN_DOMAIN>` lets the session cookie
    // set on api.<domain> be read by <domain> and every other subdomain
    // (docs, realtime). Skip in non-prod where browsers reject `.localhost`.
    crossSubDomainCookies:
      env.BRIVEN_ENV === 'production' && env.BRIVEN_DOMAIN
        ? { enabled: true, domain: `.${env.BRIVEN_DOMAIN}` }
        : { enabled: false },
    defaultCookieAttributes: {
      // 'lax' is required for OAuth callbacks. With 'strict', the state
      // cookie set when the user clicks "sign in with google" wouldn't
      // be sent when Google redirects back to api.briven.tech/v1/auth/
      // callback/google (the browser treats it as a cross-site nav from
      // accounts.google.com → api.briven.tech and strips strict cookies).
      // The result: every OAuth callback hits state_mismatch.
      //
      // 'lax' allows the cookie on top-level GET navigations (which is
      // exactly what OAuth callbacks are) while still blocking cross-site
      // POSTs that would defeat CSRF protection. CSRF on POST routes is
      // additionally guarded by the origin-check middleware
      // (apps/api/src/middleware/csrf.ts), so we lose nothing here.
      sameSite: 'lax',
      httpOnly: true,
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24 * 7, // refresh if older than 7 days
  },

  emailAndPassword: {
    enabled: true,
    // why: invite-only beta until BRIVEN_OPEN_SIGNUPS flips. Existing
    // users still sign in; only first-time signup is gated. The
    // per-method flags (here + on each social provider + on the magic
    // link plugin) are the same toggle to keep the override surface
    // small.
    disableSignUp: !env.BRIVEN_OPEN_SIGNUPS,
    requireEmailVerification: env.BRIVEN_ENV === 'production',
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordReset(user.email, url);
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmailVerification(user.email, url);
    },
  },

  // Authenticated users can change their sign-in email from the dashboard
  // Settings page. Better Auth exposes POST /v1/auth/change-email; the
  // confirmation link is sent to the CURRENT (already-verified) email so
  // a hijacked browser can't silently re-point the login email. The new
  // address only becomes the sign-in email after the user clicks the link
  // delivered to the old mailbox.
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        await sendEmailChangeConfirmation(user.email, newEmail, url);
      },
    },
  },

  // Google + GitHub use Better Auth's built-in socialProviders config.
  // Konnos (Forgejo at code.konnos.org) uses the genericOAuth plugin
  // since Forgejo isn't on Better Auth's hard-coded list.
  socialProviders: {
    ...(env.BRIVEN_GOOGLE_CLIENT_ID && env.BRIVEN_GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.BRIVEN_GOOGLE_CLIENT_ID,
            clientSecret: env.BRIVEN_GOOGLE_CLIENT_SECRET,
            disableSignUp: !env.BRIVEN_OPEN_SIGNUPS,
          },
        }
      : {}),
    ...(env.BRIVEN_GITHUB_CLIENT_ID && env.BRIVEN_GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.BRIVEN_GITHUB_CLIENT_ID,
            clientSecret: env.BRIVEN_GITHUB_CLIENT_SECRET,
            disableSignUp: !env.BRIVEN_OPEN_SIGNUPS,
          },
        }
      : {}),
    ...(env.BRIVEN_DISCORD_CLIENT_ID && env.BRIVEN_DISCORD_CLIENT_SECRET
      ? {
          discord: {
            clientId: env.BRIVEN_DISCORD_CLIENT_ID,
            clientSecret: env.BRIVEN_DISCORD_CLIENT_SECRET,
            disableSignUp: !env.BRIVEN_OPEN_SIGNUPS,
          },
        }
      : {}),
  },

  plugins: [
    magicLink({
      expiresIn: 60 * 10, // 10 minutes
      // Same gate as emailAndPassword.disableSignUp — magic-link sign-IN
      // for existing users is allowed; first-time signup is rejected
      // when BRIVEN_OPEN_SIGNUPS is false.
      disableSignUp: !env.BRIVEN_OPEN_SIGNUPS,
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLink(email, url);
      },
    }),
    // Konnos (Forgejo) OAuth — endpoints follow Forgejo's gitea-compatible
    // shape: /login/oauth/authorize, /login/oauth/access_token,
    // /api/v1/user. Forgejo's userinfo endpoint returns
    // {id, login, email, full_name, avatar_url}; mapProfileToUser
    // adapts it to Better Auth's expected shape.
    ...(env.BRIVEN_KONNOS_CLIENT_ID && env.BRIVEN_KONNOS_CLIENT_SECRET
      ? [
          genericOAuth({
            config: [
              {
                providerId: 'konnos',
                clientId: env.BRIVEN_KONNOS_CLIENT_ID,
                clientSecret: env.BRIVEN_KONNOS_CLIENT_SECRET,
                authorizationUrl: `${env.BRIVEN_KONNOS_ISSUER}/login/oauth/authorize`,
                tokenUrl: `${env.BRIVEN_KONNOS_ISSUER}/login/oauth/access_token`,
                userInfoUrl: `${env.BRIVEN_KONNOS_ISSUER}/api/v1/user`,
                scopes: ['read:user'],
                disableSignUp: !env.BRIVEN_OPEN_SIGNUPS,
                mapProfileToUser: (profile) => ({
                  id: String(profile.id),
                  email: profile.email,
                  name: profile.full_name || profile.login,
                  image: profile.avatar_url,
                  emailVerified: true,
                }),
              },
            ],
          }),
        ]
      : []),
  ],

  // - `before`: invite-only beta gate. When BRIVEN_OPEN_SIGNUPS=false,
  //   reject signups whose email isn't on the platform allowlist. The
  //   environment-driven `disableSignUp` set on every provider above is
  //   the broad "no public signups" switch; this `before` hook is the
  //   "but THESE specific emails are allowed" carve-out so admins can
  //   invite users one by one without flipping the global toggle.
  // - `after`: auto-create the personal org + mark the allowlist entry
  //   as accepted so the dashboard can show pending vs claimed invites.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // DB-backed override (platform_settings.openSignups) takes
          // precedence over the env var; the env stays as the bootstrap
          // default until the first dashboard flip writes a row.
          const { getOpenSignupsFlag } = await import('../services/platform-settings.js');
          const openSignups = await getOpenSignupsFlag();
          if (openSignups) return;
          const email = user.email?.toLowerCase().trim();
          if (!email) {
            throw new Error('signup_allowlist_required: email missing on user.create');
          }
          const { isEmailAllowed } = await import('../services/signup-allowlist.js');
          const allowed = await isEmailAllowed(email);
          if (!allowed) {
            // Throwing aborts Better Auth's signup flow — the caller
            // gets a clean error response. The string lands in
            // logs/audit per Better Auth's own error path.
            throw new Error(
              'signup_not_allowlisted: this email is not on the invite-only beta allowlist',
            );
          }
        },
        after: async (user) => {
          try {
            await ensurePersonalOrg({
              userId: user.id,
              email: user.email,
              name: user.name ?? null,
            });
          } catch (err) {
            log.error('personal_org_create_after_signup_failed', {
              userId: user.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          // Stamp the allowlist row when signups are gated. Reads the
          // same DB-backed flag the before-hook used, so a mid-flow
          // flag flip stays consistent.
          const { getOpenSignupsFlag } = await import('../services/platform-settings.js');
          const openSignups = await getOpenSignupsFlag();
          if (!openSignups) {
            try {
              const { markAllowlistAccepted } = await import(
                '../services/signup-allowlist.js'
              );
              await markAllowlistAccepted(user.email);
            } catch (err) {
              log.warn('allowlist_accepted_stamp_failed', {
                userId: user.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        },
      },
    },
  },

  logger: {
    disabled: false,
    level: env.BRIVEN_LOG_LEVEL,
    log: (level, msg, ...rest) => {
      const fields = rest.length > 0 ? { extra: rest } : undefined;
      switch (level) {
        case 'error':
          log.error(`auth: ${msg}`, fields);
          break;
        case 'warn':
          log.warn(`auth: ${msg}`, fields);
          break;
        case 'info':
          log.info(`auth: ${msg}`, fields);
          break;
        default:
          log.debug(`auth: ${msg}`, fields);
      }
    },
  },
});

export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;
