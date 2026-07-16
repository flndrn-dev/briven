import { ValidationError } from '@briven/shared';
import { z } from 'zod';

import { runInProjectDatabase } from '../db/data-plane.js';
import { log } from '../lib/logger.js';
import { hasTenantSecret } from './tenant-secrets.js';

/**
 * Non-secret per-tenant auth config (BUILD_PLAN.md §6 Providers panel +
 * §6 Branding panel + §6 Usage panel sender-domain field).
 *
 * Storage: customer's `_briven_meta` jsonb under key `auth_config`. Same
 * table that `auth.enabled` flag lives in — keeps the per-project meta
 * surface coherent.
 *
 * **Secrets do NOT live here.** OAuth client secrets, mittera API keys,
 * webhook signing keys all go through `tenant-secret-store.ts` (HKDF +
 * AES-256-GCM, control-plane `tenant_secrets` table). This file only
 * holds the flags + the public bits (OAuth client ids are public-by-design
 * per upstream provider docs).
 */

// ─── schema ─────────────────────────────────────────────────────────────

const oauthProviderConfig = z.object({
  enabled: z.boolean(),
  /**
   * Public client identifier from the upstream provider. Visible to the
   * customer's end-users in the redirect URL — not a secret.
   */
  clientId: z.string().nullable(),
});

/**
 * Generic / custom OIDC (OpenID Connect) provider configured by the customer.
 * Same non-secret split as the built-in social providers: the public client id
 * + endpoints live here (project DoltGres `_briven_meta`), the client secret
 * rides the encrypted control-plane tenant-secret-store under the name
 * `oidc_<id>_client_secret` (service 'auth').
 *
 * The provider can be configured EITHER via an OIDC `issuer` (the engine fetches
 * `<issuer>/.well-known/openid-configuration`) OR via the three explicit
 * endpoints. Either path is gated on enabled + clientId + a stored secret before
 * it reaches the Better Auth `genericOAuth` plugin (mirrors the konnos gate).
 */
const customOidcProviderConfig = z.object({
  /** URL-safe slug; also the Better Auth `providerId` + the `provider` query value. */
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'id must be a slug of lowercase letters, digits and hyphens'),
  /** Human label shown on the hosted-pages + SDK button (e.g. "Acme SSO"). */
  displayName: z.string().min(1).max(64),
  enabled: z.boolean(),
  /** Public OAuth client id from the upstream provider — not a secret. */
  clientId: z.string().nullable(),
  /**
   * OIDC issuer base URL. When set, the engine discovers the
   * authorization/token/userinfo endpoints from
   * `<issuer>/.well-known/openid-configuration`. Mutually-sufficient with the
   * three explicit endpoints below — supply one or the other.
   */
  issuer: z.string().url().nullable(),
  authorizationUrl: z.string().url().nullable(),
  tokenUrl: z.string().url().nullable(),
  userinfoUrl: z.string().url().nullable(),
  /** Space-separated OAuth scopes. Defaults to the standard OIDC trio. */
  scopes: z.string().min(1).default('openid profile email'),
  /** Whether to use PKCE on the authorization code exchange. Defaults on. */
  pkce: z.boolean().optional(),
});

export type CustomOidcProvider = z.infer<typeof customOidcProviderConfig>;

const authConfigSchema = z.object({
  providers: z.object({
    emailPassword: z.object({ enabled: z.boolean() }),
    magicLink: z.object({
      enabled: z.boolean(),
      expiryMinutes: z.number().int().min(1).max(60),
    }),
    emailOtp: z.object({
      enabled: z.boolean(),
      codeLength: z.number().int().min(4).max(8),
      expiryMinutes: z.number().int().min(1).max(30),
    }),
    passkey: z.object({ enabled: z.boolean() }),
    google: oauthProviderConfig,
    github: oauthProviderConfig,
    discord: oauthProviderConfig,
    microsoft: oauthProviderConfig,
    apple: oauthProviderConfig,
    twitter: oauthProviderConfig,
    linkedin: oauthProviderConfig,
    gitlab: oauthProviderConfig,
    bitbucket: oauthProviderConfig,
    dropbox: oauthProviderConfig,
    facebook: oauthProviderConfig,
    spotify: oauthProviderConfig,
    // Generic OIDC/OAuth provider (Forgejo at code.konnos.org). Same
    // {enabled, clientId} shape as the built-in social providers — the
    // public client id is non-secret; the secret rides the encrypted
    // tenant-secret-store like the others.
    konnos: oauthProviderConfig,
  }),
  twoFactor: z.object({
    enabled: z.boolean(),
    /** Issuer name shown in the authenticator app (defaults to project name). */
    issuer: z.string().max(64).nullable(),
    /** When true, all users MUST enroll MFA (TOTP or passkey) before signing in. */
    required: z.boolean().default(false),
  }),
  /**
   * Custom JWT claims added to every token issued by the jwt plugin.
   * Keys are claim names; values are static strings. For dynamic claims
   * (e.g. org_role), the customer should use a webhook + their own
   * signing layer; this surface is for simple static claims only.
   */
  jwtClaims: z.record(z.string().min(1).max(64), z.string().max(256)).default({}),
  branding: z.object({
    /** Customer-uploaded logo URL. Null means use the briven default mark. */
    logoUrl: z.string().url().nullable(),
    /**
     * Primary accent color. Must be a 6-digit hex (with leading `#`) so
     * the dashboard's WCAG-AA contrast check can normalise it. Defaults
     * to briven green per BRAND.md.
     */
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'primaryColor must be a 6-digit hex like #00e87a'),
    /**
     * mittera-verified sender domain (e.g. `mail.customerapp.com`). Null
     * until the customer completes the verification wizard; mail then
     * falls back to `noreply@auth.briven.tech`.
     */
    senderDomain: z
      .string()
      // RFC-1035-ish domain match — single conservative pass; mittera
      // does the authoritative DNS validation downstream.
      .regex(
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i,
        'senderDomain must be a valid DNS domain',
      )
      .nullable(),
    /** Display name in the From: header. */
    senderName: z.string().min(1).max(64),
  }),
  /**
   * Customer-defined generic OIDC providers (in addition to the built-in
   * social providers above). Optional so configs written before this field
   * existed still parse — `getAuthConfig` callers treat a missing array as `[]`.
   */
  customOidc: z.array(customOidcProviderConfig).optional(),
  /** Customer-owned auth subdomain (e.g. auth.murphus.eu). Null means use the default hosted pages. */
  customAuthDomain: z
    .string()
    .regex(
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i,
      'customAuthDomain must be a valid DNS domain',
    )
    .nullable(),
  /**
   * Session management settings (Phase 2 — BUILD_PLAN.md).
   */
  session: z
    .object({
      /** Maximum session lifetime in days (5 min to 10 years). Default 30. */
      maxLifetimeDays: z.number().int().min(1).max(3650).default(30),
      /** Refresh session token if older than this many days. Default 7. */
      updateAgeDays: z.number().int().min(1).max(365).default(7),
      /** Invalidate session after this many minutes of inactivity. 0 = disabled. */
      inactivityTimeoutMinutes: z.number().int().min(0).max(1440).default(0),
    })
    .default({ maxLifetimeDays: 30, updateAgeDays: 7, inactivityTimeoutMinutes: 0 }),
  /**
   * Security hardening settings (Phase 1 — BUILD_PLAN.md).
   * Controls sign-up gating, email restrictions, and abuse prevention.
   */
  security: z
    .object({
      /** Who may sign up: public (anyone), restricted (invite/enterprise only), waitlist (admin approval). */
      signUpMode: z.enum(['public', 'restricted', 'waitlist']).default('public'),
      /** Only allow sign-ups from these email domains. Empty = no restriction. */
      allowedEmailDomains: z.array(z.string().min(1).max(128)).default([]),
      /** Block sign-ups from these email domains. Checked before allowedEmailDomains. */
      blockedEmailDomains: z.array(z.string().min(1).max(128)).default([]),
      /** Reject known disposable email domains. */
      blockDisposableEmails: z.boolean().default(false),
      /** Reject email addresses with subaddress tags (+tag, #tag). */
      blockEmailSubaddresses: z.boolean().default(false),
      /** Check passwords against Have I Been Pwned breach database on sign-up. */
      breachDetection: z.object({ enabled: z.boolean() }).default({ enabled: false }),
      /** Rate limiting configuration for auth endpoints. */
      rateLimiting: z
        .object({
          enabled: z.boolean().default(true),
          maxAttemptsPerIp: z.number().int().min(1).max(1000).default(100),
          windowMinutes: z.number().int().min(1).max(1440).default(15),
        })
        .default({ enabled: true, maxAttemptsPerIp: 100, windowMinutes: 15 }),
    })
    .default({
      signUpMode: 'public',
      allowedEmailDomains: [],
      blockedEmailDomains: [],
      blockDisposableEmails: false,
      blockEmailSubaddresses: false,
      breachDetection: { enabled: false },
      rateLimiting: { enabled: true, maxAttemptsPerIp: 100, windowMinutes: 15 },
    }),
  /**
   * Cloudflare Turnstile bot protection (Phase 1 — BUILD_PLAN.md).
   * The site key is public (rendered in frontend); the secret is global env.
   */
  turnstile: z
    .object({
      enabled: z.boolean().default(false),
      siteKey: z.string().nullable().default(null),
    })
    .default({ enabled: false, siteKey: null }),
  /**
   * Log retention settings (Phase 6.3).
   * Controls how long audit logs and app logs are retained.
   */
  retention: z
    .object({
      /** Audit log retention in days. 7 | 30 | 90. Default 30. */
      auditLogDays: z.number().int().min(7).max(90).default(30),
      /** App log retention in days. 7 | 30 | 90. Default 7. */
      appLogDays: z.number().int().min(7).max(90).default(7),
    })
    .default({ auditLogDays: 30, appLogDays: 7 }),
  /**
   * Localization settings (Phase 6.8).
   * Default locale for hosted pages and email templates.
   */
  locale: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'locale must be a valid BCP 47 language tag')
    .default('en'),
});

export type AuthConfig = z.infer<typeof authConfigSchema>;

/**
 * Hard-coded defaults — used by `getAuthConfig` when a project has no
 * `auth_config` row yet (e.g. first dashboard load after Enable Auth).
 * Frozen so accidental mutation throws.
 *
 * Explicit literal (no `.default()` chains in the schema) because zod 4
 * tightened the type of `.default()` to the output shape, which made
 * field-level defaulting on nested objects fight typecheck. Trade-off:
 * callers must always pass a full config to `parse`; partial patches
 * route through `mergeAuthConfig` which seeds from this constant.
 */
function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === 'object' && !Object.isFrozen(obj)) {
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}

export const DEFAULT_AUTH_CONFIG: AuthConfig = deepFreeze({
  providers: {
    emailPassword: { enabled: true },
    magicLink: { enabled: false, expiryMinutes: 15 },
    emailOtp: { enabled: false, codeLength: 6, expiryMinutes: 5 },
    passkey: { enabled: false },
    google: { enabled: false, clientId: null },
    github: { enabled: false, clientId: null },
    discord: { enabled: false, clientId: null },
    microsoft: { enabled: false, clientId: null },
    apple: { enabled: false, clientId: null },
    twitter: { enabled: false, clientId: null },
    linkedin: { enabled: false, clientId: null },
    gitlab: { enabled: false, clientId: null },
    bitbucket: { enabled: false, clientId: null },
    dropbox: { enabled: false, clientId: null },
    facebook: { enabled: false, clientId: null },
    spotify: { enabled: false, clientId: null },
    konnos: { enabled: false, clientId: null },
  },
  twoFactor: { enabled: false, issuer: null, required: false },
  jwtClaims: {},
  session: { maxLifetimeDays: 30, updateAgeDays: 7, inactivityTimeoutMinutes: 0 },
  branding: {
    logoUrl: null,
    primaryColor: '#00e87a',
    senderDomain: null,
    senderName: 'briven auth',
  },
  customOidc: [],
  customAuthDomain: null,
  security: {
    signUpMode: 'public',
    allowedEmailDomains: [],
    blockedEmailDomains: [],
    blockDisposableEmails: false,
    blockEmailSubaddresses: false,
    breachDetection: { enabled: false },
    rateLimiting: { enabled: true, maxAttemptsPerIp: 100, windowMinutes: 15 },
  },
  turnstile: { enabled: false, siteKey: null },
  retention: { auditLogDays: 30, appLogDays: 7 },
  locale: 'en',
}) as AuthConfig;

// ─── pure helpers (unit-testable without postgres) ───────────────────────

/**
 * Deep-merge a partial patch over the current config, then re-validate
 * via zod so writes can't smuggle invalid shapes through. Unknown keys
 * are stripped by zod's default `.strip` mode.
 */
export function mergeAuthConfig(current: AuthConfig, patch: unknown): AuthConfig {
  if (patch === null || typeof patch !== 'object') {
    throw new ValidationError('auth config patch must be an object');
  }
  const merged = deepMerge(current as Record<string, unknown>, patch as Record<string, unknown>);
  const parsed = authConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ValidationError('auth config patch failed validation', {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const existing = out[k];
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      out[k] = deepMerge(
        existing as Record<string, unknown>,
        v as Record<string, unknown>,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── postgres-backed accessors ──────────────────────────────────────────

const META_KEY = 'auth_config';

/**
 * Read the current auth config for a project. Returns the defaults if no
 * row exists yet (project enabled auth but hasn't visited the providers
 * panel).
 *
 * Reads run inside a `runInProjectDatabase` transaction against the
 * project's own DoltGres database. Single-statement read.
 */
/**
 * DoltGres (via node-postgres) can hand a `jsonb` column back as a raw JSON
 * *string* rather than a parsed object. Normalise both shapes so a read never
 * silently fails on a perfectly-valid stored value.
 */
function normaliseJsonb(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function getAuthConfig(projectId: string): Promise<AuthConfig> {
  const rows = await runInProjectDatabase<{ value: unknown }[]>(projectId, async (tx) =>
    (await tx.unsafe(
      `SELECT value FROM "_briven_meta" WHERE key = $1 LIMIT 1`,
      [META_KEY],
    )) as { value: unknown }[],
  );
  if (rows.length === 0) return DEFAULT_AUTH_CONFIG;
  const parsed = authConfigSchema.safeParse(normaliseJsonb(rows[0]!.value));
  if (!parsed.success) {
    // A stored row exists but doesn't match the current schema (older shape,
    // or unparseable). Fall back to defaults so the read never throws — but
    // LOG it, because this silent fallback is exactly what hid a real bug
    // where valid saved config was read back as a string and discarded.
    log.warn('auth_config_parse_failed_fallback_default', {
      projectId,
      issues: parsed.error.issues.slice(0, 3),
    });
    return DEFAULT_AUTH_CONFIG;
  }
  return parsed.data;
}

/**
 * Apply a partial patch to the auth config and persist. Returns the new
 * full config. Idempotent — calling with an empty patch is a no-op write
 * that still validates the stored shape.
 */
export async function updateAuthConfig(
  projectId: string,
  patch: unknown,
): Promise<AuthConfig> {
  const current = await getAuthConfig(projectId);
  const next = mergeAuthConfig(current, patch);
  await runInProjectDatabase(projectId, async (tx) => {
    // DoltGres upsert WITHOUT `ON CONFLICT` (its `excluded` pseudo-table is
    // unsupported and ON CONFLICT behaviour has been unreliable): probe for an
    // existing row, then UPDATE or INSERT. Atomic within the BEGIN/COMMIT.
    const existing = (await tx.unsafe(
      `SELECT 1 FROM "_briven_meta" WHERE key = $1 LIMIT 1`,
      [META_KEY],
    )) as unknown[];
    if (existing.length > 0) {
      await tx.unsafe(
        `UPDATE "_briven_meta" SET value = $2::jsonb WHERE key = $1`,
        [META_KEY, JSON.stringify(next)],
      );
    } else {
      await tx.unsafe(
        `INSERT INTO "_briven_meta" (key, value) VALUES ($1, $2::jsonb)`,
        [META_KEY, JSON.stringify(next)],
      );
    }
  });
  return next;
}

/**
 * Read the `_briven_meta.auth_enabled` flag for a project. Set to true by
 * `POST /v1/projects/:id/auth/enable`; absent or `false` until then. The
 * dashboard's Overview page uses this to decide between the Enable CTA
 * and the configured state.
 */
export async function isAuthEnabled(projectId: string): Promise<boolean> {
  const rows = await runInProjectDatabase<{ value: unknown }[]>(projectId, async (tx) =>
    (await tx.unsafe(
      `SELECT value FROM "_briven_meta" WHERE key = 'auth_enabled' LIMIT 1`,
    )) as { value: unknown }[],
  );
  if (rows.length === 0) return false;
  return normaliseJsonb(rows[0]!.value) === true;
}

// ─── enabled-providers signal (render-gating) ────────────────────────────

/**
 * Built-in social provider keys, konnos-first (our own product leads). These
 * map 1:1 to the secret name convention `<key>_client_secret` and the Better
 * Auth `provider` value used to start a sign-in.
 */
export const SOCIAL_PROVIDER_KEYS = [
  'konnos',
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

/** One social provider key — the `<key>` half of `<key>_client_secret`. */
export type SocialProviderKey = (typeof SOCIAL_PROVIDER_KEYS)[number];

/** Type guard: is `v` one of the built-in social provider keys? */
export function isSocialProviderKey(v: unknown): v is SocialProviderKey {
  return typeof v === 'string' && (SOCIAL_PROVIDER_KEYS as readonly string[]).includes(v);
}

/**
 * Does a custom-OIDC entry have a usable endpoint set — an issuer OR all three
 * explicit endpoints? Mirrors the gate `buildGenericOAuthConfigs` applies in
 * the pool, so the "enabled" signal never lists a provider the engine would
 * skip.
 */
function oidcHasEndpoints(o: CustomOidcProvider): boolean {
  return Boolean(o.issuer) || Boolean(o.authorizationUrl && o.tokenUrl && o.userinfoUrl);
}

/**
 * Pure gate: which providers are fully configured given a secret-presence
 * probe. The SINGLE source of truth for "is this provider live?" — the exact
 * same `enabled && clientId && secret-present` rule `createAuthInstance` wires
 * with (custom-OIDC additionally needs an endpoint set). `hasSecret` is the
 * `<name>` half of the (projectId,'auth',name) triple so this stays sync +
 * unit-testable with a plain map.
 *
 * Returns provider keys for built-ins and the slug `id` for custom-OIDC,
 * konnos-first then the rest, then custom-OIDC in declaration order.
 */
export function computeEnabledProviders(
  config: AuthConfig,
  hasSecret: (name: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const key of SOCIAL_PROVIDER_KEYS) {
    const c = config.providers[key];
    if (c.enabled && c.clientId && hasSecret(`${key}_client_secret`)) out.push(key);
  }
  for (const o of config.customOidc ?? []) {
    if (o.enabled && o.clientId && oidcHasEndpoints(o) && hasSecret(`oidc_${o.id}_client_secret`)) {
      out.push(o.id);
    }
  }
  return out;
}

/**
 * Async wrapper over `computeEnabledProviders` that resolves secret presence
 * from the encrypted control-plane store. Batches the presence probes (never
 * decrypts) and feeds the result set into the one shared gate. Pass `preloaded`
 * to reuse a config already in hand and skip the extra meta read.
 */
export async function listEnabledProviders(
  projectId: string,
  preloaded?: AuthConfig,
): Promise<string[]> {
  const config = preloaded ?? (await getAuthConfig(projectId));
  const names = [
    ...SOCIAL_PROVIDER_KEYS.map((k) => `${k}_client_secret`),
    ...(config.customOidc ?? []).map((o) => `oidc_${o.id}_client_secret`),
  ];
  const present = await Promise.all(
    names.map((name) => hasTenantSecret(projectId, 'auth', name)),
  );
  const set = new Set(names.filter((_, i) => present[i]));
  return computeEnabledProviders(config, (name) => set.has(name));
}

/**
 * Shape of the public, UNAUTHENTICATED branding/config payload. Carries only
 * non-secret presentation + the enabled-provider signal — NEVER a clientId,
 * secret, toggle, or endpoint. The hosted pages + SDK read this to decide which
 * OAuth buttons to render.
 */
export interface AuthBrandingPublicPayload {
  primaryColor: string;
  senderName: string;
  /** Enabled provider keys / custom-OIDC slugs — the `provider` start value. */
  socialProviders: string[];
  /** Display labels for the enabled custom-OIDC entries (built-ins self-label). */
  customOidc: Array<{ id: string; displayName: string }>;
  /** Turnstile bot-protection config (public site key only). */
  turnstile: {
    enabled: boolean;
    siteKey: string | null;
  };
}

/**
 * Build the public branding/config payload from a config + its already-computed
 * enabled list. Deliberately projects ONLY safe fields so a clientId/secret can
 * never leak through this unauthenticated surface.
 */
export function buildAuthBrandingPublicPayload(
  config: AuthConfig,
  enabledProviders: string[],
): AuthBrandingPublicPayload {
  const enabled = new Set(enabledProviders);
  return {
    primaryColor: config.branding.primaryColor,
    senderName: config.branding.senderName,
    socialProviders: enabledProviders,
    customOidc: (config.customOidc ?? [])
      .filter((o) => enabled.has(o.id))
      .map((o) => ({ id: o.id, displayName: o.displayName })),
    turnstile: {
      enabled: config.turnstile.enabled,
      siteKey: config.turnstile.siteKey,
    },
  };
}

// ─── custom-OIDC CRUD ────────────────────────────────────────────────────

/**
 * Validate + upsert a single custom-OIDC provider (keyed by `id`) into the
 * project's config, persisting via `updateAuthConfig`. Replacing the whole
 * `customOidc` array is intentional — `deepMerge` treats arrays as wholesale
 * replacements, so we recompute the array here. Returns the new full config.
 * Throws `ValidationError` on a malformed entry (bad slug, missing displayName…).
 */
export async function upsertCustomOidcProvider(
  projectId: string,
  entry: unknown,
): Promise<AuthConfig> {
  const parsed = customOidcProviderConfig.safeParse(entry);
  if (!parsed.success) {
    throw new ValidationError('custom OIDC provider failed validation', {
      issues: parsed.error.issues,
    });
  }
  const e = parsed.data;
  const current = await getAuthConfig(projectId);
  const list = (current.customOidc ?? []).filter((o) => o.id !== e.id);
  return updateAuthConfig(projectId, { customOidc: [...list, e] });
}

/**
 * Remove a custom-OIDC provider by `id`. Idempotent — removing an absent id is
 * a no-op write that still re-validates the stored shape. The encrypted secret
 * (`oidc_<id>_client_secret`) is left in place (harmless: nothing references it
 * once the entry is gone, and the gate requires the entry to exist).
 */
export async function removeCustomOidcProvider(
  projectId: string,
  id: string,
): Promise<AuthConfig> {
  const current = await getAuthConfig(projectId);
  const list = (current.customOidc ?? []).filter((o) => o.id !== id);
  return updateAuthConfig(projectId, { customOidc: list });
}

/**
 * Visible-for-tests: the raw zod schema. Lets test files exercise
 * validation without going through the postgres path.
 */
export const __authConfigSchema = authConfigSchema;

/** Visible-for-tests: the custom-OIDC element schema. */
export const __customOidcSchema = customOidcProviderConfig;
