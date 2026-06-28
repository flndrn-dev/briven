import { loadEnv } from '@briven/shared';
import { z } from 'zod';

const envSchema = z.object({
  BRIVEN_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  BRIVEN_REALTIME_PORT: z.coerce.number().int().positive().default(3004),
  BRIVEN_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Where to dispatch invokes — same internal apps/api hostname the runtime
  // hits. Realtime never talks to the runtime directly; the api owns the
  // auth + project resolution chain.
  BRIVEN_API_INTERNAL_URL: z.string().url().default('http://localhost:3001'),

  // Shared with apps/api so realtime can call internal endpoints; also used
  // to validate the bearer token on the WebSocket upgrade.
  BRIVEN_RUNTIME_SHARED_SECRET: z.string().min(32).optional(),

  // @README-BRIVEN ADR 0001 — DoltGres data-plane DSN (postgres:// wire).
  // The shared data-plane cluster where each project lives in its own
  // DoltGres database (proj_<id>). Phase 1 stubs out LISTEN/NOTIFY;
  // Phase 2 PollManager opens a per-project postgres.js client against
  // this DSN for commit-diff polling. Mirrors apps/api's
  // BRIVEN_DATA_PLANE_URL — optional so local dev can boot without a
  // data plane; polling stays disabled until it is set.
  BRIVEN_DATA_PLANE_URL: z.string().url().optional(),

  // Poll interval in ms for commit-diff change detection. Lower = less
  // latency but more database load. Default 500 ms, floor 100 ms, cap 5000 ms.
  BRIVEN_REALTIME_POLL_MS: z.coerce.number().int().min(100).max(5000).default(500),

  // Idle timeout in seconds — Bun closes a WebSocket after this many
  // seconds of inactivity (no incoming messages or pong frames). With
  // sendPings:true Bun pings live sockets to keep them under the limit and
  // detect dead ones. Default 120 s; clamped to Bun's valid range [1, 960].
  BRIVEN_REALTIME_IDLE_TIMEOUT_S: z.coerce.number().int().min(1).max(960).default(120),

  // Per-WebSocket subscription cap. A single client opening more than
  // this many concurrent subs gets `error: subscription_limit_ws`. Sized
  // so a normal app (one page, ~dozens of useQuery hooks) is well under,
  // but a bug or malicious loop is bounded before it OOMs realtime.
  BRIVEN_REALTIME_MAX_SUBS_PER_WS: z.coerce.number().int().positive().default(200),

  // Per-project hard cap on concurrent subs across all WS connections.
  // Defaults to the team-tier cap from services/tiers.ts so a misconfig
  // doesn't accidentally clamp Team customers. Tier-aware enforcement
  // (free=100/pro=1000/team=10000) waits for the realtime → api tier
  // RPC; this single ceiling is the Phase 1 backstop.
  BRIVEN_REALTIME_MAX_SUBS_PER_PROJECT: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.infer<typeof envSchema>;
export const env = loadEnv(envSchema);
