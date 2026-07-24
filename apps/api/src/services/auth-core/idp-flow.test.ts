import { describe, expect, test } from 'bun:test';

import { createHash } from 'node:crypto';

/**
 * Pure helpers / discovery shape — no DB.
 */
describe('briven-engine OIDC IdP (pure)', () => {
  test('PKCE S256 is sha256 base64url of verifier', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    // Known vector from RFC 7636 appendix B
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  test('discovery document has required OIDC fields', async () => {
    process.env.BRIVEN_BETTER_AUTH_SECRET =
      process.env.BRIVEN_BETTER_AUTH_SECRET ?? 'a'.repeat(32);
    process.env.BRIVEN_API_ORIGIN =
      process.env.BRIVEN_API_ORIGIN ?? 'https://api.briven.tech';
    process.env.BRIVEN_WEB_ORIGIN =
      process.env.BRIVEN_WEB_ORIGIN ?? 'https://briven.tech';
    process.env.BRIVEN_DATABASE_URL =
      process.env.BRIVEN_DATABASE_URL ?? 'postgres://test:test@127.0.0.1:5/test';

    const { discoveryDocument, oidcIssuer } = await import('./idp-flow.js');
    const doc = discoveryDocument();
    expect(doc.issuer).toBe(oidcIssuer());
    expect(String(doc.authorization_endpoint)).toContain('/authorize');
    expect(String(doc.token_endpoint)).toContain('/token');
    expect(String(doc.userinfo_endpoint)).toContain('/userinfo');
    expect(String(doc.jwks_uri)).toContain('/jwks.json');
    expect(String(doc.revocation_endpoint)).toContain('/revoke');
    expect(String(doc.introspection_endpoint)).toContain('/introspect');
    expect(String(doc.end_session_endpoint)).toContain('/end_session');
    expect(doc.response_types_supported).toEqual(['code']);
    expect(doc.grant_types_supported).toContain('authorization_code');
    expect(doc.grant_types_supported).toContain('refresh_token');
    expect(doc.code_challenge_methods_supported).toContain('S256');
  });
});
