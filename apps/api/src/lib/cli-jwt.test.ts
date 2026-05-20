process.env.BRIVEN_BETTER_AUTH_SECRET = 'a'.repeat(32);

import { describe, expect, it } from 'bun:test';

describe('cli-jwt', () => {
  it('round-trips a user id', async () => {
    const { signCliToken, verifyCliToken } = await import('./cli-jwt.js');
    const token = await signCliToken('u_test123');
    const payload = await verifyCliToken(token);
    expect(payload.sub).toBe('u_test123');
    expect(payload.scope).toBe('cli');
  });

  it('rejects a forged token', async () => {
    const { verifyCliToken } = await import('./cli-jwt.js');
    await expect(verifyCliToken('not.a.jwt')).rejects.toThrow();
  });

  it('rejects a token with scope != cli', async () => {
    const { verifyCliToken } = await import('./cli-jwt.js');
    const { SignJWT } = await import('jose');
    const { env } = await import('../env.js');
    const secret = new TextEncoder().encode(env.BRIVEN_BETTER_AUTH_SECRET);
    const bad = await new SignJWT({ scope: 'session' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u_x')
      .setIssuer('briven-api')
      .setAudience('briven-cli')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    await expect(verifyCliToken(bad)).rejects.toThrow(/scope/);
  });
});
