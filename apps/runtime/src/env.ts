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
  BRIVEN_RUNTIME_SHARED_SECRET: z.string().min(32).optional(),
});

export type Env = z.infer<typeof envSchema>;

export const env = loadEnv(envSchema);
