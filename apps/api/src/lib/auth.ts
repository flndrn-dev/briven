import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';

import { getDb } from '../db/client.js';
import { env } from '../env.js';
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

  database: drizzleAdapter(getDb(), { provider: 'pg' }),

  advanced: {
    cookiePrefix: 'briven',
    useSecureCookies: env.BRIVEN_ENV === 'production',
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

  socialProviders: env.BRIVEN_GITHUB_CLIENT_ID && env.BRIVEN_GITHUB_CLIENT_SECRET
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
