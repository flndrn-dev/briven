import { newId, ValidationError, brivenError } from '@briven/shared';
import { and, eq, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { projectAuthOrigins } from '../db/schema.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * Per-project "allowed app domains" — the browser guest list.
 *
 * Each project registers the origins its own app is served from (e.g.
 * `https://konnos.org`, or a wildcard `https://*.konnos.org` covering every
 * subdomain). Three gates consult this allowlist so a customer app can log in
 * through briven auth from its own domain:
 *   - the global CORS gate (apps/api/src/index.ts) — every request
 *   - the CSRF origin check (middleware/csrf.ts)
 *   - each tenant's Better Auth `trustedOrigins` (services/auth-tenant-pool.ts)
 *
 * SAFETY: the hot path (`isRegisteredOrigin`) reads an in-memory Set only — it
 * NEVER touches the database and NEVER throws. If the cache failed to load, the
 * set is simply empty and behaviour falls back to "briven's own origins only"
 * (exactly today's behaviour). A bug here can therefore never take the API down.
 *
 * The control-plane table is created idempotently on first cache load
 * (CREATE TABLE IF NOT EXISTS) so no drizzle migration/snapshot is required —
 * same pattern as auth-provisioning + the per-project _briven_meta table.
 */

/** Non-superadmin cap on registered origins per project. */
export const APP_DOMAINS_CAP = 20;

/** Thrown when a non-superadmin project hits the origin cap. Maps to HTTP 402. */
export class AppDomainLimitExceeded extends brivenError {
  constructor(count: number, limit: number) {
    super(
      'app_domain_limit_exceeded',
      `allowed app domains limit reached (${count}/${limit})`,
      { status: 402, context: { count, limit } },
    );
    this.name = 'AppDomainLimitExceeded';
  }
}

export interface AllowedOrigin {
  id: string;
  origin: string;
  isWildcard: boolean;
  createdAt: string;
}

// ─── in-memory cache (the hot path) ─────────────────────────────────────────

interface CacheEntry {
  /** Exact origins (scheme://host[:port], lowercased). */
  exact: Set<string>;
  /** Wildcard base origins (scheme://host, lowercased) — match host + subdomains. */
  wildcards: string[];
}

let CACHE: CacheEntry = { exact: new Set(), wildcards: [] };
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const db = getDb();
  // Idempotent, single-statement DDL (postgres-js runs one statement per call).
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS "project_auth_origins" (
        "id" text PRIMARY KEY NOT NULL,
        "project_id" text NOT NULL,
        "origin" text NOT NULL,
        "is_wildcard" boolean DEFAULT false NOT NULL,
        "created_by" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      )`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_auth_origins_project_origin_idx" ON "project_auth_origins" ("project_id","origin")`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "project_auth_origins_origin_idx" ON "project_auth_origins" ("origin")`,
    ),
  );
  tableReady = true;
}

/**
 * Briven's own origins — always trusted, independent of the DB/cache.
 * Includes product host aliases (app./admin./www.) for the apex in
 * BRIVEN_WEB_ORIGIN — Traefik serves the dashboard on briven.tech AND
 * app.briven.tech; CLI Allow was failing CSRF on the app host (2026-07-29).
 */
export function brivenOwnOrigins(): string[] {
  const list = new Set<string>();
  for (const o of [
    env.BRIVEN_WEB_ORIGIN,
    env.BRIVEN_STUDIO_ORIGIN,
    env.BRIVEN_ADMIN_ORIGIN,
    env.BRIVEN_API_ORIGIN,
  ]) {
    if (o) list.add(o.replace(/\/$/, ''));
  }
  try {
    const web = new URL(env.BRIVEN_WEB_ORIGIN);
    const host = web.hostname;
    // Only add aliases for real product apex hosts (not localhost).
    if (host && !host.includes('localhost') && host !== '127.0.0.1') {
      for (const sub of ['app', 'admin', 'www']) {
        list.add(`${web.protocol}//${sub}.${host}`);
      }
    }
  } catch {
    /* ignore bad WEB_ORIGIN */
  }
  return [...list].filter(Boolean);
}

/**
 * Normalise an origin to `scheme://host[:port]`, lowercased, no trailing slash.
 * Returns null if it isn't a valid http(s) origin. A leading `*.` on the host is
 * preserved (wildcard marker handled separately).
 */
export function normaliseOrigin(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/\/+$/, '');
  const m = /^(https?):\/\/(\*\.)?([a-z0-9.-]+)(:[0-9]{1,5})?$/.exec(trimmed);
  if (!m) return null;
  const scheme = m[1];
  const wild = m[2] ?? '';
  const host = m[3];
  const port = m[4] ?? '';
  if (!host || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  return `${scheme}://${wild}${host}${port}`;
}

/**
 * HOT PATH. Is this incoming Origin header registered by ANY project (or a
 * briven-own origin)? Pure in-memory; never throws, never hits the DB.
 */
export function isRegisteredOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  try {
    const norm = normaliseOrigin(origin);
    if (!norm) return false;
    if (brivenOwnOrigins().includes(norm)) return true;
    if (CACHE.exact.has(norm)) return true;
    // wildcard entries are stored normalised as `scheme://*.base` → compare hosts
    const om = /^(https?):\/\/([^/]+)$/.exec(norm);
    if (!om) return false;
    const originScheme = om[1];
    const originHostPort = om[2];
    if (!originScheme || !originHostPort) return false;
    for (const w of CACHE.wildcards) {
      const wm = /^(https?):\/\/\*\.([^/]+)$/.exec(w);
      if (!wm) continue;
      const wildcardBase = wm[2];
      if (wildcardBase && wm[1] === originScheme && (originHostPort === wildcardBase || originHostPort.endsWith(`.${wildcardBase}`))) return true;
    }
    return false;
  } catch {
    return false; // fail closed for customer origins; briven-own handled above
  }
}

/** For the CORS `origin` callback: echo the origin if trusted, else null. */
export function resolveCorsOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  return isRegisteredOrigin(origin) ? origin : null;
}

// ─── cache loading + refresh ────────────────────────────────────────────────

async function loadCache(): Promise<void> {
  try {
    await ensureTable();
    const rows = await getDb()
      .select({ origin: projectAuthOrigins.origin, isWildcard: projectAuthOrigins.isWildcard })
      .from(projectAuthOrigins);
    const exact = new Set<string>();
    const wildcards: string[] = [];
    for (const r of rows) {
      if (r.isWildcard) wildcards.push(r.origin);
      else exact.add(r.origin);
    }
    CACHE = { exact, wildcards };
  } catch (err) {
    // Never let a load failure crash boot or a request. Keep the last-good
    // cache (or empty) — briven-own origins still work.
    log.warn('auth_origin_allowlist_load_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Kick off background loading + periodic refresh. Safe to call at boot. */
export function startOriginAllowlist(): void {
  void loadCache();
  if (!refreshTimer) {
    refreshTimer = setInterval(() => void loadCache(), 60_000);
    if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
  }
}

// ─── per-project reads (for tenant Better Auth) ─────────────────────────────

/**
 * The registered origins for ONE project, as concrete trustedOrigins strings
 * for Better Auth. Wildcards are expanded to Better Auth's `*.base` form.
 * Called at tenant-instance build time (infrequent), so a direct query is fine.
 */
export async function originsForProject(projectId: string): Promise<string[]> {
  try {
    await ensureTable();
    const rows = await getDb()
      .select({ origin: projectAuthOrigins.origin })
      .from(projectAuthOrigins)
      .where(eq(projectAuthOrigins.projectId, projectId));
    return rows.map((r) => r.origin);
  } catch (err) {
    log.warn('auth_origins_for_project_failed', {
      projectId,
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ─── admin CRUD (for the dashboard routes) ──────────────────────────────────

export async function listOrigins(projectId: string): Promise<AllowedOrigin[]> {
  await ensureTable();
  const rows = await getDb()
    .select()
    .from(projectAuthOrigins)
    .where(eq(projectAuthOrigins.projectId, projectId));
  return rows
    .map((r) => ({
      id: r.id,
      origin: r.origin,
      isWildcard: r.isWildcard,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
    }))
    .sort((a, b) => a.origin.localeCompare(b.origin));
}

export async function addOrigin(input: {
  projectId: string;
  origin: string;
  isWildcard: boolean;
  createdBy: string;
  /** When true, the per-project cap is skipped (founder/superadmin). */
  unlimited: boolean;
}): Promise<AllowedOrigin> {
  const norm = normaliseOrigin(input.origin);
  if (!norm) {
    throw new ValidationError(
      'domain must be a full origin like https://yourapp.com (optionally https://*.yourapp.com for subdomains)',
      { origin: input.origin },
    );
  }
  const isWildcard = input.isWildcard || norm.includes('://*.');
  // Store wildcards consistently in `scheme://*.host` form so the matcher
  // (which keys off the `*.`) works whether the caller typed `*.` themselves
  // or just ticked the wildcard box on a bare `https://host`.
  const stored =
    isWildcard && !norm.includes('://*.') ? norm.replace(/^(https?:\/\/)/, '$1*.') : norm;
  await ensureTable();
  const db = getDb();

  if (!input.unlimited) {
    const existing = await db
      .select({ id: projectAuthOrigins.id })
      .from(projectAuthOrigins)
      .where(eq(projectAuthOrigins.projectId, input.projectId));
    if (existing.length >= APP_DOMAINS_CAP) {
      throw new AppDomainLimitExceeded(existing.length, APP_DOMAINS_CAP);
    }
  }

  const row = {
    id: newId('ao'),
    projectId: input.projectId,
    origin: stored,
    isWildcard,
    createdBy: input.createdBy,
  };
  try {
    await db.insert(projectAuthOrigins).values(row);
  } catch (err) {
    // Unique index (project_id, origin) — treat as a friendly 400.
    throw new ValidationError('that domain is already registered for this project', {
      origin: norm,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  void loadCache(); // refresh the hot-path cache immediately
  return { id: row.id, origin: stored, isWildcard, createdAt: new Date().toISOString() };
}

export async function removeOrigin(projectId: string, originId: string): Promise<boolean> {
  await ensureTable();
  const deleted = await getDb()
    .delete(projectAuthOrigins)
    .where(and(eq(projectAuthOrigins.id, originId), eq(projectAuthOrigins.projectId, projectId)))
    .returning({ id: projectAuthOrigins.id });
  void loadCache();
  return deleted.length > 0;
}
