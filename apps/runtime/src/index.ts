import { Hono } from 'hono';
import { z } from 'zod';

import { env } from './env.js';
import { handleInvoke } from './invoke.js';
import type { InvokeRequest } from './types.js';

const invokeSchema = z.object({
  projectId: z.string().min(1),
  functionName: z.string().min(1).max(128),
  deploymentId: z.string().min(1),
  requestId: z.string().min(1),
  args: z.unknown(),
  auth: z
    .object({
      userId: z.string().min(1),
      tokenType: z.enum(['session', 'api_key']),
    })
    .nullable()
    .default(null),
});

const app = new Hono();

app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'runtime', executor: env.BRIVEN_RUNTIME_EXECUTOR }),
);

app.get('/ready', (c) => c.json({ status: 'ready' }));

app.post('/invoke', async (c) => {
  const expected = env.BRIVEN_RUNTIME_SHARED_SECRET;
  if (expected) {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
    if (token !== expected) {
      return c.json({ code: 'unauthorized', message: 'runtime is not open to the public' }, 401);
    }
  }

  const body = await c.req.json().catch(() => null);
  const parsed = invokeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }

  const result = await handleInvoke(parsed.data as InvokeRequest);
  // Always 200 — the business-level outcome is in the body. The runtime
  // treats user-code failures as data, not HTTP errors, so the control
  // plane can observe durations and error codes uniformly.
  return c.json(result);
});

app.notFound((c) => c.json({ code: 'not_found', message: 'route not found' }, 404));

console.log(
  JSON.stringify({
    event: 'runtime_boot',
    port: env.BRIVEN_RUNTIME_PORT,
    executor: env.BRIVEN_RUNTIME_EXECUTOR,
    bundleDir: env.BRIVEN_RUNTIME_BUNDLE_DIR,
  }),
);

export default {
  port: env.BRIVEN_RUNTIME_PORT,
  fetch: app.fetch,
};
