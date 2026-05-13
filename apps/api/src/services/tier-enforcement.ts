import { TIERS, getProjectTier } from './tiers.js';
import { currentMonthBounds, getInvocationUsage } from './usage.js';

/**
 * Monthly invocation cap enforcement.
 *
 * Called from the invoke route on every request, so the underlying DB
 * query for current-month invocations is cached in-process for 60s. A
 * over-cap project then leaks ≤60s of additional invocations before the
 * rejection fires — acceptable for the alpha, and the operator can drop
 * the TTL once the dashboard quota meter goes live.
 *
 * Why an explicit service (not just a `tiers.ts` helper): the cache lives
 * here, isolated from the tier resolution path which already has its own
 * cache with different semantics + invalidation.
 */

const TTL_MS = 60_000;

interface CacheEntry {
  current: number;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export interface QuotaState {
  tier: 'free' | 'pro' | 'team';
  current: number;
  limit: number;
  // True when current >= limit. Callers should reject with 429 before
  // forwarding the invoke to the runtime.
  exceeded: boolean;
}

/**
 * Returns the project's quota state for the current UTC calendar month.
 * Defaults to `free` tier behaviour if the project is unknown — that
 * branch only kicks in for ids that don't exist, which the upstream auth
 * middleware will 401 before this gets called.
 */
export async function getQuotaState(projectId: string): Promise<QuotaState> {
  const tier = (await getProjectTier(projectId)) ?? 'free';
  const limit = TIERS[tier].invokesPerMonth;
  const current = await getCachedCurrentMonthInvocations(projectId);
  return {
    tier,
    current,
    limit,
    exceeded: current >= limit,
  };
}

async function getCachedCurrentMonthInvocations(projectId: string): Promise<number> {
  const now = Date.now();
  const hit = cache.get(projectId);
  if (hit && hit.expiresAt > now) return hit.current;

  const { periodStart, periodEnd } = currentMonthBounds();
  const usage = await getInvocationUsage(projectId, periodStart, periodEnd);
  cache.set(projectId, { current: usage.count, expiresAt: now + TTL_MS });
  return usage.count;
}

/** Drop the cached count for one project — used by tests. */
export function invalidateQuotaCache(projectId: string): void {
  cache.delete(projectId);
}

/** Drop everything cached — used by tests + the polar webhook on plan changes. */
export function clearQuotaCache(): void {
  cache.clear();
}
