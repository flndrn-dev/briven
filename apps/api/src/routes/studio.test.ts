const ORIGINAL_SECRET = process.env.BRIVEN_BETTER_AUTH_SECRET;
process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET ?? 'a'.repeat(32);

import type { AppEnv } from '../types/app-env.js';
import { describe, expect, it, afterAll } from 'bun:test';
import { Hono } from 'hono';

describe('GET /v1/projects/:id/studio/schema-export', () => {
  it('handler is mounted and responds (auth/db permitting)', async () => {
    const { studioRouter } = await import('./studio.js');
    const { signCliToken } = await import('../lib/cli-jwt.js');

    const app = new Hono<AppEnv>();
    app.route('/', studioRouter);

    const token = await signCliToken('u_schema_export_test');
    const res = await app.request('/v1/projects/p_test/studio/schema-export', {
      headers: { authorization: `Bearer ${token}` },
    });
    // Post-A8: CLI JWT now traverses requireProjectAuth. A 401 here is
    // only acceptable if it comes from the new cli-jwt branch (e.g.
    // "invalid cli token" / "cli token user not found") — never from
    // the old `brk_` rejection. The message guard proves which path ran.
    if (res.status === 401) {
      const body = (await res.json()) as { message?: string };
      expect(body.message ?? '').not.toMatch(/brk_/i);
    }
    expect([200, 401, 403, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = (await res.json()) as { schemaTs: string };
      expect(body.schemaTs).toContain('export default schema(');
    }
  });
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BRIVEN_BETTER_AUTH_SECRET;
  else process.env.BRIVEN_BETTER_AUTH_SECRET = ORIGINAL_SECRET;
});
