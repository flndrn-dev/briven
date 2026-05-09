import { env } from './env.js';

/**
 * Per-project env var cache for the Deno isolate executor. The control
 * plane decrypts and serves env vars over `/v1/internal/projects/:id/env`
 * (shared-secret-protected); we cache the response for 60s so a hot
 * project doesn't pay a fetch on every cold-start.
 *
 * Invalidation strategy: pure TTL. When users update an env var via the
 * dashboard, the next cold-start within 60s still uses the old value.
 * That's the correct trade-off for Phase 1 — env edits are rare and the
 * worst case is a one-minute delay, not a security hole.
 */
const cache = new Map<string, { values: Record<string, string>; expiresAt: number }>();
const TTL_MS = 60_000;

export async function fetchProjectEnv(projectId: string): Promise<Record<string, string>> {
  const cached = cache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.values;

  const headers: Record<string, string> = { accept: 'application/json' };
  if (env.BRIVEN_RUNTIME_SHARED_SECRET) {
    headers['authorization'] = `Bearer ${env.BRIVEN_RUNTIME_SHARED_SECRET}`;
  }
  const url = `${env.BRIVEN_API_INTERNAL_URL}/v1/internal/projects/${projectId}/env`;
  const res = await fetch(url, { headers });
  if (res.status === 404) {
    cache.set(projectId, { values: {}, expiresAt: Date.now() + TTL_MS });
    return {};
  }
  if (!res.ok) throw new Error(`fetchProjectEnv ${projectId}: ${res.status}`);
  const values = (await res.json()) as Record<string, string>;
  cache.set(projectId, { values, expiresAt: Date.now() + TTL_MS });
  return values;
}

/** Test hook — clears the in-memory cache so unit tests don't see staleness. */
export function clearProjectEnvCache(): void {
  cache.clear();
}
