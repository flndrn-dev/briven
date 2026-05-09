import { describe, expect, it } from 'bun:test';

describe('runtime smoke', () => {
  it('env module loads with defaults', async () => {
    const { env } = await import('./env.js');
    expect(env.BRIVEN_ENV).toMatch(/^(development|staging|production)$/);
    expect(env.BRIVEN_RUNTIME_PORT).toBeGreaterThan(0);
  });
});
