import { ValidationError } from '@briven/shared';
import { z } from 'zod';

import { runInProjectDatabase } from '../db/data-plane.js';

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
  }),
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
  },
  branding: {
    logoUrl: null,
    primaryColor: '#00e87a',
    senderDomain: null,
    senderName: 'briven auth',
  },
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
export async function getAuthConfig(projectId: string): Promise<AuthConfig> {
  const rows = await runInProjectDatabase<{ value: unknown }[]>(projectId, async (tx) =>
    (await tx.unsafe(
      `SELECT value FROM "_briven_meta" WHERE key = $1 LIMIT 1`,
      [META_KEY],
    )) as { value: unknown }[],
  );
  if (rows.length === 0) return DEFAULT_AUTH_CONFIG;
  const parsed = authConfigSchema.safeParse(rows[0]!.value);
  if (!parsed.success) {
    // Stale config row written by an older schema version. Don't fail
    // the read — fall back to defaults and let the next write fix it.
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
    await tx.unsafe(
      `INSERT INTO "_briven_meta" (key, value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [META_KEY, JSON.stringify(next)],
    );
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
  return rows[0]!.value === true;
}

/**
 * Visible-for-tests: the raw zod schema. Lets test files exercise
 * validation without going through the postgres path.
 */
export const __authConfigSchema = authConfigSchema;
