import { describe, expect, it } from 'bun:test';

/**
 * Regression guard for the fail-OPEN /invoke bug: the bearer check used to be
 * gated inside `if (expected)`, so an unset BRIVEN_RUNTIME_SHARED_SECRET
 * skipped auth entirely and left the endpoint open. The route must now fail
 * CLOSED — a missing OR mismatched token is always 401, regardless of whether
 * the secret is configured. Both assertions below hold either way, so the
 * test doesn't depend on the secret being unset in the test env.
 */
describe('runtime /invoke auth (fail-closed)', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const app = (await import('./index.js')).default;
    const res = await app.fetch(
      new Request('http://localhost/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p',
          functionName: 'f',
          deploymentId: 'd',
          requestId: 'r',
          args: {},
        }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a request with a bogus bearer token with 401', async () => {
    const app = (await import('./index.js')).default;
    const res = await app.fetch(
      new Request('http://localhost/invoke', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer this-is-not-the-secret',
        },
        body: JSON.stringify({
          projectId: 'p',
          functionName: 'f',
          deploymentId: 'd',
          requestId: 'r',
          args: {},
        }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
