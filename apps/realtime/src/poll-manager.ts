import { createLogger } from '@briven/shared/observability';
import pg from 'pg';

import { env } from './env.js';
import type { SubscriptionRegistry } from './subscription-registry.js';

const log = createLogger({
  service: 'realtime',
  env: env.BRIVEN_ENV,
  level: env.BRIVEN_LOG_LEVEL,
});

/**
 * PollManager — DoltGres commit-diff polling engine.
 *
 * Replaces Postgres LISTEN/NOTIFY with periodic polling of DoltGres's
 * commit log. Each active project is polled at a configurable interval
 * (default 500 ms, configurable via BRIVEN_REALTIME_POLL_MS).
 *
 * DoltGres speaks the Postgres wire protocol, so we use the `pg` driver
 * (node-postgres) — the same driver the converged data plane uses.
 * postgres.js is deliberately NOT used: its extended-protocol pipelining
 * desyncs against DoltGres. Postgres cannot switch database mid-connection
 * (there is no `USE`), so we maintain one `pg` pool per project, each bound
 * to that project's database (`proj_<id>`) via the `database` option.
 *
 * Poll cycle per project:
 *   1. Resolve the project's `pg` pool (bound to proj_<id>)
 *   2. Query `SELECT DOLT_HASHOF('HEAD') AS h` to get the current commit
 *      hash — DOLT_HASHOF is DoltGres's real commit-hash function
 *   3. If the hash changed since last poll, fire every channel for that
 *      project via the provided `onChange` callback
 *
 * @README-BRIVEN Phase 2: This replaces the Phase 1 stubs in
 * `apps/realtime/src/index.ts:startListen` / `stopListen`.
 * When no projects are active, the interval timer stops to avoid
 * burning CPU on an empty poll set.
 */
export class PollManager {
  /** Base data-plane URL (a postgres:// DSN). Set by init(). */
  private baseUrl: string | null = null;
  /** Per-project `pg` pools, each bound to proj_<id>. */
  private readonly clients = new Map<string, pg.Pool>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lastHashes = new Map<string, string>();
  private readonly activeProjects = new Set<string>();
  private readonly intervalMs: number;

  constructor(
    /** Registry used to discover which channels belong to a project. */
    private readonly registry: SubscriptionRegistry,
    /**
     * Called for every channel whose project's HEAD changed since the
     * last poll. The caller is responsible for re-invoking subscriptions
     * and shipping data frames.
     */
    private readonly onChange: (channel: string) => Promise<void>,
    intervalMs = 500,
  ) {
    this.intervalMs = Math.max(100, Math.min(intervalMs, 5000));
  }

  /**
   * Record the data-plane DSN. Call once at boot. Per-project clients are
   * opened lazily (in addProject / on first poll) since each binds to a
   * different database via the postgres.js `database` option.
   */
  async init(dataPlaneUrl: string): Promise<void> {
    this.baseUrl = dataPlaneUrl;
  }

  /** Start watching a project for changes. Idempotent. */
  addProject(projectId: string): void {
    if (this.activeProjects.has(projectId)) return;
    this.activeProjects.add(projectId);
    // Open the project's client eagerly so the first poll doesn't pay
    // connection setup inline. No-op if init() hasn't run yet.
    this.clientFor(projectId);
    this.tryStartPolling();
  }

  /** Stop watching a project. Called when its last channel is removed. */
  removeProject(projectId: string): void {
    this.activeProjects.delete(projectId);
    this.lastHashes.delete(projectId);
    const client = this.clients.get(projectId);
    if (client) {
      this.clients.delete(projectId);
      // Fire-and-forget close; a failed teardown must not block removal.
      client.end().catch(() => undefined);
    }
    if (this.activeProjects.size === 0) this.stopPolling();
  }

  /** True when at least one project is being watched. */
  get active(): boolean {
    return this.activeProjects.size > 0;
  }

  /** Number of projects currently watched. */
  get projectCount(): number {
    return this.activeProjects.size;
  }

  // ── internals ──────────────────────────────────────────────────────

  /**
   * Resolve (lazily creating) the `pg` pool bound to a project's DoltGres
   * database. Returns null until init() has supplied the DSN.
   */
  private clientFor(projectId: string): pg.Pool | null {
    if (!this.baseUrl) return null;
    let client = this.clients.get(projectId);
    if (!client) {
      const base = new URL(this.baseUrl);
      client = new pg.Pool({
        host: base.hostname,
        port: Number(base.port || 5432),
        user: decodeURIComponent(base.username),
        password: decodeURIComponent(base.password),
        database: dbNameFor(projectId),
        max: 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
      this.clients.set(projectId, client);
    }
    return client;
  }

  private tryStartPolling(): void {
    if (this.timer || this.activeProjects.size === 0) return;
    this.timer = setInterval(() => {
      this.poll().catch(() => {
        /* errors logged inside poll() */
      });
    }, this.intervalMs);
    // Run an immediate first poll so a fresh subscription gets its
    // initial hash seeded without waiting for the interval.
    this.poll().catch(() => undefined);
  }

  private stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.baseUrl || this.activeProjects.size === 0) return;

    const projects = [...this.activeProjects];
    for (const projectId of projects) {
      try {
        const hash = await this.fetchHeadHash(projectId);
        if (hash === null) continue;
        const last = this.lastHashes.get(projectId);
        if (last !== undefined && hash === last) continue;
        // First poll: store hash but don't fire (no baseline).
        // Subsequent polls: hash changed → fire channels.
        this.lastHashes.set(projectId, hash);
        if (last !== undefined) {
          await this.fireProjectChannels(projectId);
        }
      } catch (err) {
        // Per-project failure shouldn't block other projects. Surface it
        // at warn level so a broken DSN / missing database / DoltGres
        // outage is visible instead of silently looking like "no live
        // updates". No secrets or URLs are logged — only the project id
        // and the error message.
        log.warn('realtime_poll_failed', {
          projectId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async fetchHeadHash(projectId: string): Promise<string | null> {
    const pool = this.clientFor(projectId);
    if (!pool) return null;
    const { rows } = await pool.query<{ h: string | null }>("SELECT DOLT_HASHOF('HEAD') AS h");
    return rows[0]?.h ?? null;
  }

  private async fireProjectChannels(projectId: string): Promise<void> {
    const channels = this.registry.channelsForProject(projectId);
    for (const channel of channels) {
      await this.onChange(channel);
    }
  }

  /** Shut down the poll timer and all per-project clients. Graceful-exit hook. */
  async close(): Promise<void> {
    this.stopPolling();
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
  }
}

/**
 * Derive the DoltGres database name for a project id.
 * Must stay in sync with `apps/api/src/db/data-plane.ts:dbNameFor`.
 */
function dbNameFor(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `proj_${safe}`;
}
