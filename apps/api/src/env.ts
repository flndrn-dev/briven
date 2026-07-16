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

  // Data-plane: shared DoltGres (Postgres-wire git-for-data) cluster where
  // each project gets its own DATABASE (`proj_<id>`) — not a schema — so it
  // has an independent commit history / branch namespace. Reached via
  // postgres.js. CLAUDE.md §3.4 — database-per-tenant up to Team tier, then
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

  // Per-tenant secret store master keys (ARCHITECTURE.md §4). 32-byte hex.
  // Each service has its own key so a leak of one cannot decrypt the other.
  BRIVEN_AUTH_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  BRIVEN_PAY_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  // Kill-switch envs for the per-service routers (ARCHITECTURE.md §9).
  // Default disabled — set BRIVEN_AUTH_ENABLED=true in Dokploy when the
  // briven auth router is ready to serve customer traffic.
  BRIVEN_AUTH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

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

  // Polar meter UUIDs per metric — read by the meter-push worker. Until
  // set, usage_events rows are marked `skipped` and the operator can
  // verify what we'd push via the admin usage page.
  BRIVEN_POLAR_METER_INVOCATIONS_ID: z.string().optional(),
  BRIVEN_POLAR_METER_STORAGE_ID: z.string().optional(),
  BRIVEN_POLAR_METER_CONNECTION_ID: z.string().optional(),
  // briven auth MAU meter — distinct users active in the trailing 30 days,
  // pushed by polar-meter-push.ts when usage_events.metric='auth_mau'.
  // Unset means skip; rows mark 'skipped' and the operator can flip them
  // back to 'pending' once the meter is provisioned.
  BRIVEN_POLAR_METER_AUTH_MAU_ID: z.string().optional(),

  // mittera.eu transactional email. Outbound sends authenticate with
  // the API key; inbound webhooks (delivery / bounce / complaint) are
  // verified with the webhook secret. URL + API key must both be set
  // for mail to go out; missing either falls back to stdout-only for
  // first-user bootstrap. Webhook secret is only required if mittera
  // posts events back — without it the receiver returns 503.
  BRIVEN_MITTERA_API_URL: z.string().url().optional(),
  BRIVEN_MITTERA_API_KEY: z.string().optional(),
  BRIVEN_MITTERA_WEBHOOK_SECRET: z.string().optional(),

  // Real SMTP transport. mittera.eu accepts sends (200) but does NOT
  // deliver (proven by 44 `.sent` audit rows and ZERO `.delivered`
  // webhooks), so once a real provider (Resend / Mailgun / Postmark / SES
  // — all speak standard SMTP) is wired here, SMTP becomes the PRIMARY
  // sender and mittera drops to a fallback. SMTP is "configured" only when
  // HOST + USER + PASS are all non-empty; PORT defaults to 587 (STARTTLS),
  // and secure TLS is used automatically on 465. FROM overrides the
  // fromAddress() default when set (e.g. "Briven <noreply@briven.tech>").
  BRIVEN_SMTP_HOST: z.string().optional(),
  BRIVEN_SMTP_PORT: z.coerce.number().int().positive().default(587),
  BRIVEN_SMTP_USER: z.string().optional(),
  BRIVEN_SMTP_PASS: z.string().optional(),
  BRIVEN_SMTP_FROM: z.string().optional(),

  // MinIO — object storage.
  //   _ENDPOINT          server-side (internal docker network OK).
  //   _PUBLIC_ENDPOINT   what the browser sees in presigned URLs. HTTPS
  //                      in prod. Falls back to _ENDPOINT if unset (dev).
  //   _BUCKET / _REGION  defaults: "briven" / "us-east-1".
  BRIVEN_MINIO_ENDPOINT: z.string().url().optional(),
  BRIVEN_MINIO_PUBLIC_ENDPOINT: z.string().url().optional(),
  BRIVEN_MINIO_ACCESS_KEY: z.string().optional(),
  BRIVEN_MINIO_SECRET_KEY: z.string().optional(),
  BRIVEN_MINIO_BUCKET: z.string().optional(),
  BRIVEN_MINIO_REGION: z.string().optional(),

  // imgproxy — on-the-fly image transforms (M4). Signed URLs let the browser
  // request a resized variant of a PUBLIC file; imgproxy fetches the source
  // from the /media host, resizes, and returns it. All three must be set for
  // the feature to be available — when any is unset the transform endpoint
  // returns 503 not_configured (fail-safe; the imgproxy container is wired at
  // deploy). _KEY / _SALT are hex, per imgproxy's URL-signing scheme.
  BRIVEN_IMGPROXY_ENDPOINT: z.string().url().optional(),
  BRIVEN_IMGPROXY_KEY: z.string().optional(),
  BRIVEN_IMGPROXY_SALT: z.string().optional(),

  // Dokploy — infra provisioning (Phase 2+).
  BRIVEN_DOKPLOY_API_URL: z.string().url().optional(),
  BRIVEN_DOKPLOY_API_TOKEN: z.string().optional(),

  // Google OAuth — used by Better Auth for the "sign in with google" flow.
  BRIVEN_GOOGLE_CLIENT_ID: z.string().optional(),
  BRIVEN_GOOGLE_CLIENT_SECRET: z.string().optional(),

  // GitHub OAuth — paired with Google for the second mainstream provider.
  BRIVEN_GITHUB_CLIENT_ID: z.string().optional(),
  BRIVEN_GITHUB_CLIENT_SECRET: z.string().optional(),

  // Discord OAuth — useful for gaming / community-oriented apps. Falls
  // back to "not available" in the signin UI when unset.
  BRIVEN_DISCORD_CLIENT_ID: z.string().optional(),
  BRIVEN_DISCORD_CLIENT_SECRET: z.string().optional(),
  // Public invite URL for the beta Discord server. When set, the
  // dashboard and admin status panel surface a "join the alpha discord"
  // link. Operator sets this once the server is created (see
  // docs/runbooks/discord-setup.md).
  BRIVEN_DISCORD_INVITE_URL: z.string().url().optional(),

  // Inbox the operator notification email is sent to whenever a
  // customer submits /dashboard/projects/new/migrate/<source>.
  // Default points at flndrn.com (the parent legal entity that runs
  // briven + ISY + Mavi from a single support queue at admin.flndrn.com).
  // Override if you want product-specific routing later.
  BRIVEN_MIGRATIONS_INBOX: z.string().email().default('migrations@flndrn.com'),

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
  BRIVEN_STUDIO_ORIGIN: z.string().url().default('http://localhost:8082'),
  // Dedicated admin cockpit host (admin.<domain>) — must be CORS-allowed or
  // every client-side fetch from the cockpit dies with "Failed to fetch".
  BRIVEN_ADMIN_ORIGIN: z.string().url().optional(),
  // Comma-separated allowlist of emails that may EVER be platform admin.
  // When set, the users.isAdmin DB flag alone no longer grants admin —
  // see lib/superadmin.ts. Unset = DB flag decides (local dev).
  BRIVEN_SUPERADMIN_EMAILS: z.string().optional(),

  // Comma-separated list of origins Better Auth will accept as `callbackURL`.
  // Must include every public hostname that serves the dashboard.
  BRIVEN_TRUSTED_ORIGINS: z.string().default('http://localhost:3000'),

  // Runtime — apps/runtime's invoke endpoint. The shared secret must match
  // BRIVEN_RUNTIME_SHARED_SECRET on the runtime host.
  BRIVEN_RUNTIME_URL: z.string().url().default('http://localhost:3003'),
  BRIVEN_RUNTIME_SHARED_SECRET: z.string().min(32).optional(),

  // Realtime — apps/realtime's /metrics endpoint. The hourly usage
  // aggregator scrapes briven_realtime_connection_seconds_total{project}
  // from here to compute per-project per-hour connection-second deltas.
  // Optional — when unset the aggregator skips connection_seconds and
  // only writes invocations + storage_bytes.
  BRIVEN_REALTIME_URL: z.string().url().default('http://localhost:3004'),

  // Prometheus base URL for the Phase 4 observability stack. Read by
  // services/platform-health.ts (instant host metrics) and
  // routes/admin-timeseries.ts (24h range queries for the cockpit charts).
  // Optional — when unset those surfaces return null and the cockpit shows
  // "monitoring not connected"; we never fabricate a number.
  BRIVEN_PROMETHEUS_URL: z.string().url().optional(),

  // GeoIP — optional path to a MaxMind GeoLite2-City.mmdb file. When unset
  // or unreadable, IP → city lookups return null and callers show a dash.
  // Refresh the DB monthly via the free MaxMind account download portal.
  BRIVEN_GEOIP_DB_PATH: z.string().optional(),

  // Ollama base URL for the AI features (schema gen / function gen /
  // explain / docs assistant). Points at the production proxy at
  // ai.flndrn.com today; switches to a local DGX hostname once the
  // hardware lands. When unset, /v1/projects/:id/ai/* endpoints return
  // 503 not_configured and the dashboard hides the AI affordances.
  BRIVEN_OLLAMA_URL: z.string().url().optional(),
  // Optional bearer token for the Ollama backend. The production
  // proxy at ai.flndrn.com is gated by API-key auth; a local Ollama
  // on the DGX over a private network doesn't need this (leave unset).
  // When set we send `Authorization: Bearer <key>` on every /api/generate
  // request. NEVER log this value.
  BRIVEN_OLLAMA_API_KEY: z.string().optional(),
  // Default model id — must match what Ollama has pulled / what the
  // proxy exposes. Each AI feature can override via
  // BRIVEN_OLLAMA_MODEL_<FEATURE> below; unset means "fall back to this
  // default". See docs/AI.md for the recommended per-feature matrix.
  BRIVEN_OLLAMA_MODEL: z.string().default('qwen2.5-coder:32b'),
  BRIVEN_OLLAMA_MODEL_SCHEMA: z.string().optional(),
  BRIVEN_OLLAMA_MODEL_FUNCTION: z.string().optional(),
  BRIVEN_OLLAMA_MODEL_EXPLAIN: z.string().optional(),
  BRIVEN_OLLAMA_MODEL_DOCS: z.string().optional(),

  // admin.flndrn.com dashboard API key. Single shared bearer secret the
  // cross-product operator console at admin.flndrn.com sends on every
  // probe of briven's /api/admin/* endpoints. Must equal the key
  // registered for briven in admin.flndrn.com. Optional: when unset, the
  // /api/admin/* routes return 503 admin_not_configured (fail-safe — the
  // dashboard shows "not configured" rather than the process crashing).
  BRIVEN_ADMIN_API_KEY: z.string().optional(),

  // Public-signups gate. Default false — invite-only beta. Flip to `true`
  // when public open-signups land per BUILD_PLAN Phase 4. Affects every
  // first-time auth path (email+password, magic link, Google OAuth);
  // existing users always retain sign-IN regardless of this flag.
  BRIVEN_OPEN_SIGNUPS: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  // Cloudflare Turnstile — invisible CAPTCHA replacement for bot protection
  // on briven auth sign-up / sign-in flows. The site key is per-tenant config;
  // this secret verifies tokens server-side.
  BRIVEN_TURNSTILE_SECRET_KEY: z.string().optional(),
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
  // why: BRIVEN_DATA_PLANE_URL is marked .optional() so local dev can boot
  // without a data-plane, but every customer-facing operation (project
  // create, schema apply, studio reads/writes) requires it. Failing here
  // surfaces the misconfiguration at boot instead of on the first request.
  if (!env.BRIVEN_DATA_PLANE_URL) {
    throw new Error(
      'BRIVEN_DATA_PLANE_URL must be set outside development (per-project schemas live in this cluster)',
    );
  }
}
