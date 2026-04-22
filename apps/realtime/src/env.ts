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
});

export type Env = z.infer<typeof envSchema>;
export const env = loadEnv(envSchema);
