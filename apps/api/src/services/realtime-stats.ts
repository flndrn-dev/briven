import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * Live snapshot of the realtime service: per-project subscription counts,
 * per-channel refcounts, the caps the service is enforcing right now.
 * Authenticates via the shared secret — same gate as /v1/subscribe so
 * an unauth scrape can't enumerate project ids through this surface.
 *
 * Reads are cheap (an O(subs.size) walk on the realtime side) so we
 * fetch live every time instead of caching. At the year-one 10k
 * concurrent-sub target a snapshot is single-digit-millisecond work.
 */

export interface RealtimeStats {
  readonly totalSubscriptions: number;
  readonly totalChannels: number;
  readonly limits: {
    readonly perWs: number;
    readonly perProject: number;
  };
  readonly byProject: readonly { projectId: string; subscriptions: number }[];
  readonly byChannel: readonly { channel: string; subscriptions: number }[];
}

export async function fetchRealtimeStats(): Promise<RealtimeStats | null> {
  if (!env.BRIVEN_REALTIME_URL || !env.BRIVEN_RUNTIME_SHARED_SECRET) return null;
  try {
    const res = await fetch(`${env.BRIVEN_REALTIME_URL}/v1/realtime/stats`, {
      headers: { authorization: `Bearer ${env.BRIVEN_RUNTIME_SHARED_SECRET}` },
    });
    if (!res.ok) {
      log.warn('realtime_stats_http', { status: res.status });
      return null;
    }
    return (await res.json()) as RealtimeStats;
  } catch (err) {
    log.warn('realtime_stats_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
