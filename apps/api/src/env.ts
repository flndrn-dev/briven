import { loadEnv } from '@briven/shared';
import { z } from 'zod';

/**
 * Control-plane env schema. Every var carries the `BRIVEN_` prefix per
 * CLAUDE.md §4. Missing required vars fail the process at boot.
 *
 * Vars that Phase 1 doesn't yet need are marked `.optional()`; they become
 * required as the services that consume them come online.
 */
const envSchema = z.object({
  BRIVEN_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  BRIVEN_API_PORT: z.coerce.number().int().positive().default(3001),
  BRIVEN_API_ORIGIN: z.string().url().default('http://localhost:3001'),
  BRIVEN_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Control-plane meta-DB — required once Phase 1 week 1 services are wired.
  BRIVEN_DATABASE_URL: z.string().url().optional(),

  // Data-plane: shared postgres cluster where each project gets its own
  // schema. CLAUDE.md §3.4 — schema-per-tenant up to Team tier, then
  // dedicated cluster per tenant. Phase 1 has one cluster.
  BRIVEN_DATA_PLANE_URL: z.string().url().optional(),

  // Redis — sessions, queues. Optional until auth lands.
  BRIVEN_REDIS_URL: z.string().url().optional(),

  // Auth + JWT signing. Optional until Better Auth lands in Phase 1.
  BRIVEN_BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BRIVEN_JWT_SIGNING_KEY: z.string().min(32).optional(),

  // Pepper for audit-log IP hashing. Separate from BETTER_AUTH_SECRET so
  // a leak of the audit-log column (or someone with shell on the API box)
  // can't trivially de-anonymise IPs by knowing the auth secret. Required
  // in non-development; in dev a per-process ephemeral value is used.
  BRIVEN_AUDIT_IP_PEPPER: z.string().min(32).optional(),

  // Encryption key for customer secrets at rest (AES-256).
  BRIVEN_ENCRYPTION_KEY: z.string().min(32).optional(),

  // Polar.sh billing — Phase 3.
  // Sandbox vs production: set BRIVEN_POLAR_API_BASE to
  //   https://sandbox-api.polar.sh   during dev
  //   https://api.polar.sh           once the production product exists
  // Matching access tokens + webhook secrets come from the matching env.
  BRIVEN_POLAR_API_BASE: z.string().url().default('https://api.polar.sh'),
  BRIVEN_POLAR_ACCESS_TOKEN: z.string().optional(),
  BRIVEN_POLAR_WEBHOOK_SECRET: z.string().optional(),
  // Polar product UUIDs per tier. Checkout + webhook → tier mapping both
  // read these. Until they're set, `/v1/billing/plans` reports no plans
  // and the settings page keeps the upgrade UI disabled.
  BRIVEN_POLAR_PRO_PRODUCT_ID: z.string().optional(),
  BRIVEN_POLAR_TEAM_PRODUCT_ID: z.string().optional(),

  // mittera.eu transactional email. Outbound sends authenticate with
  // the API key; inbound webhooks (delivery / bounce / complaint) are
  // verified with the webhook secret. URL + API key must both be set
  // for mail to go out; missing either falls back to stdout-only for
  // first-user bootstrap. Webhook secret is only required if mittera
  // posts events back — without it the receiver returns 503.
  BRIVEN_MITTERA_API_URL: z.string().url().optional(),
  BRIVEN_MITTERA_API_KEY: z.string().optional(),
  BRIVEN_MITTERA_WEBHOOK_SECRET: z.string().optional(),

  // MinIO — object storage.
  BRIVEN_MINIO_ENDPOINT: z.string().url().optional(),
  BRIVEN_MINIO_ACCESS_KEY: z.string().optional(),
  BRIVEN_MINIO_SECRET_KEY: z.string().optional(),

  // Dokploy — infra provisioning (Phase 2+).
  BRIVEN_DOKPLOY_API_URL: z.string().url().optional(),
  BRIVEN_DOKPLOY_API_TOKEN: z.string().optional(),

  // Google OAuth — used by Better Auth for the "sign in with google" flow.
  BRIVEN_GOOGLE_CLIENT_ID: z.string().optional(),
  BRIVEN_GOOGLE_CLIENT_SECRET: z.string().optional(),

  // GitHub OAuth — paired with Google for the second mainstream provider.
  BRIVEN_GITHUB_CLIENT_ID: z.string().optional(),
  BRIVEN_GITHUB_CLIENT_SECRET: z.string().optional(),

  // Konnos OAuth — Forgejo at code.konnos.org. Better Auth's generic OAuth
  // plugin lets us reuse the same callback shape for any OAuth2/OIDC
  // provider; the Forgejo endpoints (authorize / token / userinfo) are
  // pinned below.
  BRIVEN_KONNOS_CLIENT_ID: z.string().optional(),
  BRIVEN_KONNOS_CLIENT_SECRET: z.string().optional(),
  BRIVEN_KONNOS_ISSUER: z.string().url().default('https://code.konnos.org'),

  // Public domain (registrable, no scheme). Drives cross-subdomain cookie
  // scope so the session cookie set on api.<domain> is readable by the
  // dashboard at <domain> (and docs/realtime). Required in production.
  BRIVEN_DOMAIN: z.string().optional(),

  // Web origin for email link callbacks.
  BRIVEN_WEB_ORIGIN: z.string().url().default('http://localhost:3000'),

  // Comma-separated list of origins Better Auth will accept as `callbackURL`.
  // Must include every public hostname that serves the dashboard.
  BRIVEN_TRUSTED_ORIGINS: z.string().default('http://localhost:3000'),

  // Runtime — apps/runtime's invoke endpoint. The shared secret must match
  // BRIVEN_RUNTIME_SHARED_SECRET on the runtime host.
  BRIVEN_RUNTIME_URL: z.string().url().default('http://localhost:3003'),
  BRIVEN_RUNTIME_SHARED_SECRET: z.string().min(32).optional(),

  // GeoIP — optional path to a MaxMind GeoLite2-City.mmdb file. When unset
  // or unreadable, IP → city lookups return null and callers show a dash.
  // Refresh the DB monthly via the free MaxMind account download portal.
  BRIVEN_GEOIP_DB_PATH: z.string().optional(),

  // Public-signups gate. Default false — invite-only beta. Flip to `true`
  // when public open-signups land per BUILD_PLAN Phase 4. Affects every
  // first-time auth path (email+password, magic link, Google OAuth);
  // existing users always retain sign-IN regardless of this flag.
  BRIVEN_OPEN_SIGNUPS: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof envSchema>;

export const env = loadEnv(envSchema);

/**
 * Cross-field invariants that zod can't easily express via `.refine()`
 * because they depend on the resolved BRIVEN_ENV. Run after loadEnv so the
 * process fails loudly at boot when production config is wrong.
 */
if (env.BRIVEN_ENV !== 'development') {
  if (!env.BRIVEN_API_ORIGIN.startsWith('https://')) {
    throw new Error(
      `BRIVEN_API_ORIGIN must be HTTPS outside development (got: ${env.BRIVEN_API_ORIGIN})`,
    );
  }
  if (!env.BRIVEN_WEB_ORIGIN.startsWith('https://')) {
    throw new Error(
      `BRIVEN_WEB_ORIGIN must be HTTPS outside development (got: ${env.BRIVEN_WEB_ORIGIN})`,
    );
  }
  // why: BRIVEN_ENCRYPTION_KEY decrypts customer env vars at rest. If
  // unset, services/project-env.ts fails-closed at request time — but a
  // deploy that forgot the key would only surface the misconfiguration
  // when the first customer reads encrypted env. Fail at boot instead.
  if (!env.BRIVEN_ENCRYPTION_KEY) {
    throw new Error(
      'BRIVEN_ENCRYPTION_KEY must be set outside development (AES-256 KEK for customer env vars at rest)',
    );
  }
}
