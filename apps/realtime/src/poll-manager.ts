import mysql from 'mysql2/promise';

import type { SubscriptionRegistry } from './subscription-registry.js';

/**
 * PollManager — Dolt commit-diff polling engine.
 *
 * Replaces Postgres LISTEN/NOTIFY with periodic polling of Dolt's commit
 * log. Each active project is polled at a configurable interval (default
 * 500 ms, configurable via BRIVEN_REALTIME_POLL_MS).
 *
 * Poll cycle per project:
 *   1. Acquire a connection from the pool, `USE proj_<id>`
 *   2. Query `SELECT BRIVEN_HASHOF('HEAD')` to get the current commit hash
 *   3. If the hash changed since last poll, fire every channel for that
 *      project via the provided `onChange` callback
 *
 * @README-BRIVEN Phase 2: This replaces the Phase 1 stubs in
 * `apps/realtime/src/index.ts:startListen` / `stopListen`.
 * When no projects are active, the interval timer stops to avoid
 * burning CPU on an empty poll set.
 */
export class PollManager {
  private pool: mysql.Pool | null = null;
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

  /** Lazy-init the shared pool. Call once at boot. */
  async init(doltUrl: string): Promise<void> {
    if (this.pool) return;
    this.pool = mysql.createPool({
      uri: doltUrl,
      connectionLimit: 4,
      idleTimeout: 30000,
      connectTimeout: 5000,
    });
  }

  /** Start watching a project for changes. Idempotent. */
  addProject(projectId: string): void {
    if (this.activeProjects.has(projectId)) return;
    this.activeProjects.add(projectId);
    this.tryStartPolling();
  }

  /** Stop watching a project. Called when its last channel is removed. */
  removeProject(projectId: string): void {
    this.activeProjects.delete(projectId);
    this.lastHashes.delete(projectId);
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
    if (!this.pool || this.activeProjects.size === 0) return;

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
      } catch {
        // Per-project failure shouldn't block other projects.
        // A missing database or transient connection blip
        // resolves on the next cycle.
      }
    }
  }

  private async fetchHeadHash(projectId: string): Promise<string | null> {
    if (!this.pool) return null;
    const conn = await this.pool.getConnection();
    try {
      await conn.query(`USE \`${dbNameFor(projectId)}\``);
      const [rows] = await conn.query(
        'SELECT BRIVEN_HASHOF(?) AS h',
        ['HEAD'],
      );
      const h = (rows as Array<{ h: string | null }>)[0]?.h;
      return h ?? null;
    } finally {
      conn.release();
    }
  }

  private async fireProjectChannels(projectId: string): Promise<void> {
    const channels = this.registry.channelsForProject(projectId);
    for (const channel of channels) {
      await this.onChange(channel);
    }
  }

  /** Shut down the poll timer and pool. Graceful-exit hook. */
  async close(): Promise<void> {
    this.stopPolling();
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

/**
 * Derive the Dolt database name for a project id.
 * Must stay in sync with `apps/api/src/db/data-plane.ts:dbNameFor`.
 */
function dbNameFor(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `proj_${safe}`;
}
