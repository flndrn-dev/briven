import { loadEnv } from '@briven/shared';
import { z } from 'zod';

const envSchema = z.object({
  BRIVEN_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  BRIVEN_RUNTIME_PORT: z.coerce.number().int().positive().default(3003),
  BRIVEN_RUNTIME_BUNDLE_DIR: z.string().default('./data/bundles'),
  BRIVEN_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Strategy for executing user code. `inline` runs it in this process
  // (Phase 1 dev only — NOT isolated, not safe for untrusted code).
  // `deno` spawns a Deno subprocess per project with a locked-down permission
  // set (Phase 2 — customer-facing).
  BRIVEN_RUNTIME_EXECUTOR: z.enum(['inline', 'deno']).default('inline'),

  // Shared secret between apps/api (control plane) and apps/runtime.
  // Every invoke from the api carries this in `Authorization: Bearer <secret>`.
  // The runtime reuses it the other direction when fetching bundles from the
  // api's /v1/internal/* endpoints.
  BRIVEN_RUNTIME_SHARED_SECRET: z.string().min(32).optional(),

  // Internal apps/api URL, reachable on the swarm overlay network. Used
  // only for bundle fetches; never the public api.briven.tech hostname.
  BRIVEN_API_INTERNAL_URL: z.string().url().default('http://localhost:3001'),

  // @README-BRIVEN ADR 0001 — Dolt URL for the runtime's database pool.
  // The runtime opens pooled connections here and switches database
  // per invoke via `USE proj_<projectId>`.
  BRIVEN_URL: z.string().url().optional(),

  // Redis URL — used to publish function invocation log envelopes as a
  // stream. Optional: when unset the publisher is a no-op and invocations
  // still succeed, they're just not tailable via `briven logs`.
  BRIVEN_REDIS_URL: z.string().url().optional(),

  // Cap on retained stream entries per project before Redis trims the head.
  // `MAXLEN ~` uses approximate trimming so the cap isn't exact, which is
  // what we want — fast writes, bounded memory.
  BRIVEN_LOGS_STREAM_MAX: z.coerce.number().int().positive().default(10_000),

  // Deno isolate pool control: max concurrent isolates, per-isolate memory cap,
  // invocation timeout, idle kill threshold, and crash-loop detection breaker.
  // Also: tmp directory for isolate scratch and deno binary path.
  BRIVEN_RUNTIME_MAX_ISOLATES: z.coerce.number().int().positive().default(50),
  BRIVEN_RUNTIME_ISOLATE_MAX_MEMORY_MB: z.coerce.number().int().positive().default(128),
  BRIVEN_RUNTIME_INVOCATION_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  BRIVEN_RUNTIME_IDLE_KILL_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  BRIVEN_RUNTIME_MAX_INVOCATIONS_PER_ISOLATE: z.coerce.number().int().positive().default(1000),
  BRIVEN_RUNTIME_CRASH_LOOP_THRESHOLD: z.coerce.number().int().positive().default(3),
  BRIVEN_RUNTIME_CRASH_LOOP_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  BRIVEN_RUNTIME_TMP_DIR: z.string().default('/tmp'),
  BRIVEN_RUNTIME_DENO_PATH: z.string().default('deno'),
});

export type Env = z.infer<typeof envSchema>;

export const env = loadEnv(envSchema);
