/**
 * Generic per-tenant engine instance pool — Layer 2 primitive shared
 * between briven auth and (future) briven pay.
 *
 * Each service hands the pool a factory `(projectId) => Promise<TEngine>`;
 * the pool caches instances by projectId with idle-TTL eviction and an
 * LRU cap. See `ARCHITECTURE.md` §3 for the lifecycle contract.
 *
 * Concurrency guarantee: two `get(projectId)` calls in the same tick share
 * a single factory invocation via the in-flight promise map — important
 * when the factory builds a heavy resource (Better Auth instance + drizzle
 * client + decrypted secrets).
 */

export interface TenantInstancePoolOpts<TEngine> {
  /** Maximum number of cached instances. LRU eviction at the cap. */
  readonly maxSize: number;
  /** Idle TTL in ms. Instances unused for this long are evicted on next access. */
  readonly idleTtlMs: number;
  /** Build a fresh instance for a project id. Called on cache miss. */
  readonly factory: (projectId: string) => Promise<TEngine>;
  /**
   * Optional hook fired when an instance is evicted (idle, LRU, or forced).
   * Use it to release resources held by the instance (DB connections, etc).
   * Errors are forwarded to `onEvictError` but do not fail the calling get().
   */
  readonly onEvict?: (projectId: string, instance: TEngine) => void | Promise<void>;
  /** Receives errors thrown from `onEvict`. Default: no-op. */
  readonly onEvictError?: (projectId: string, error: unknown) => void;
}

interface Entry<TEngine> {
  instance: TEngine;
  lastAccess: number;
}

export class TenantInstancePool<TEngine> {
  private readonly map = new Map<string, Entry<TEngine>>();
  private readonly pending = new Map<string, Promise<TEngine>>();

  constructor(private readonly opts: TenantInstancePoolOpts<TEngine>) {
    if (opts.maxSize <= 0) throw new Error('TenantInstancePool: maxSize must be > 0');
    if (opts.idleTtlMs <= 0) throw new Error('TenantInstancePool: idleTtlMs must be > 0');
  }

  /**
   * Fetch (or create) the instance for a project. Concurrent calls for the
   * same projectId share a single factory invocation.
   */
  async get(projectId: string): Promise<TEngine> {
    // Dedupe concurrent first-creates.
    const inflight = this.pending.get(projectId);
    if (inflight) return inflight;

    const now = Date.now();
    const hit = this.map.get(projectId);
    if (hit) {
      if (now - hit.lastAccess > this.opts.idleTtlMs) {
        // Stale; evict + cold-create below.
        await this.evict(projectId);
      } else {
        // LRU touch: re-insert to move to the tail of insertion order.
        hit.lastAccess = now;
        this.map.delete(projectId);
        this.map.set(projectId, hit);
        return hit.instance;
      }
    }

    const p = this.opts
      .factory(projectId)
      .then(async (instance) => {
        this.pending.delete(projectId);
        // Evict the LRU if we're at the cap. Map insertion order = oldest first.
        while (this.map.size >= this.opts.maxSize) {
          const oldest = this.map.keys().next().value;
          if (!oldest) break;
          await this.evict(oldest);
        }
        this.map.set(projectId, { instance, lastAccess: Date.now() });
        return instance;
      })
      .catch((err: unknown) => {
        this.pending.delete(projectId);
        throw err;
      });
    this.pending.set(projectId, p);
    return p;
  }

  /**
   * Force-evict a single project. Called by the dashboard's PATCH handlers
   * when a tenant's config changes (provider toggled, secret rotated,
   * branding updated) so the next request creates a fresh instance.
   */
  async evict(projectId: string): Promise<void> {
    const entry = this.map.get(projectId);
    if (!entry) return;
    this.map.delete(projectId);
    if (this.opts.onEvict) {
      try {
        await this.opts.onEvict(projectId, entry.instance);
      } catch (err) {
        this.opts.onEvictError?.(projectId, err);
      }
    }
  }

  /** Drop every cached instance. Test + shutdown hook. */
  async clear(): Promise<void> {
    for (const projectId of [...this.map.keys()]) {
      await this.evict(projectId);
    }
  }

  /** Number of cached instances (excludes in-flight creates). */
  get size(): number {
    return this.map.size;
  }

  /** True iff a fresh-or-warm entry exists for this projectId. */
  has(projectId: string): boolean {
    const hit = this.map.get(projectId);
    if (!hit) return false;
    return Date.now() - hit.lastAccess <= this.opts.idleTtlMs;
  }

  /** Snapshot of project ids in LRU order (oldest first). Test helper. */
  __snapshot(): string[] {
    return [...this.map.keys()];
  }
}
