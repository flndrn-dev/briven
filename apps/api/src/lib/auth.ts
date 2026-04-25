import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';

import { getDb } from '../db/client.js';
import { accounts, sessions, users, verifications } from '../db/schema.js';
import { env } from '../env.js';
import { ensurePersonalOrg } from '../services/orgs.js';
import { log } from './logger.js';
import { sendEmailVerification, sendMagicLink } from './email.js';

/**
 * Better Auth instance. Per BUILD_PLAN Phase 1 week 1-2 we wire all three
 * auth methods from day one: email + password, magic link via Resend, and
 * GitHub OAuth — so j can sign into the dashboard on day one.
 *
 * All cookies are HTTP-only and SameSite=lax. Session TTL is 30 days; the
 * sliding-refresh refresh window is 7 days (session is extended on any
 * authenticated request inside that window).
 */
export const auth = betterAuth({
  appName: 'briven',
  secret: env.BRIVEN_BETTER_AUTH_SECRET ?? 'dev-insecure-fallback-change-in-prod',
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
    // `.briven.cloud` lets the session cookie set on api.briven.cloud be
    // read by briven.cloud and every other subdomain (ws, docs, etc.).
    // In non-prod the browser won't accept `.localhost`, so we skip it.
    crossSubDomainCookies:
      env.BRIVEN_ENV === 'production'
        ? { enabled: true, domain: '.briven.cloud' }
        : { enabled: false },
    defaultCookieAttributes: {
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

  socialProviders:
    env.BRIVEN_GITHUB_CLIENT_ID && env.BRIVEN_GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.BRIVEN_GITHUB_CLIENT_ID,
            clientSecret: env.BRIVEN_GITHUB_CLIENT_SECRET,
          },
        }
      : {},

  plugins: [
    magicLink({
      expiresIn: 60 * 10, // 10 minutes
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLink(email, url);
      },
    }),
  ],

  // Auto-create the personal org for every new user (email/password,
  // magic link, GitHub OAuth — all paths funnel through this hook).
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
