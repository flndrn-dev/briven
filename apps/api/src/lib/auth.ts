import { randomBytes } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth, magicLink } from 'better-auth/plugins';

import { getDb } from '../db/client.js';
import { accounts, sessions, users, verifications } from '../db/schema.js';
import { env } from '../env.js';
import { ensurePersonalOrg } from '../services/orgs.js';
import { log } from './logger.js';
import { sendEmailVerification, sendMagicLink } from './email.js';

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
      // 'strict' — kills cross-site form-POST CSRF. Dashboard at briven.tech
      // and API at api.briven.tech are same-site (registrable domain
      // briven.tech), so the dashboard's authenticated XHR/fetch keeps
      // working; only cross-site navigations from third-party origins lose
      // the cookie.
      sameSite: 'strict',
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
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmailVerification(user.email, url);
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

  // Auto-create the personal org for every new user (email/password,
  // magic link, Google OAuth — all paths funnel through this hook).
  // Migration 0010 backfilled existing users; this closes the gap for
  // signups that happen after that migration ran. Failures are logged
  // but never re-thrown — `getDefaultOrgForUser` self-heals on first
  // /v1/me, so a transient hook failure is recoverable.
  databaseHooks: {
    user: {
      create: {
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
