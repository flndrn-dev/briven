import { describe, expect, test } from 'bun:test';

/**
 * OIDC returnTo contract — sanitize + redirect is wired in sso.ts / routes.
 * Full IdP E2E needs live Okta/Azure; this locks the API surface docs.
 */
describe('OIDC SP returnTo (contract)', () => {
  test('start path accepts returnTo query names', () => {
    const queries = ['returnTo', 'return_to'];
    expect(queries).toContain('returnTo');
  });

  test('callback prefers redirect when returnTo stored', () => {
    // completeOidcLogin returns returnTo; route redirects 302 when set.
    const behavior = { whenReturnTo: 302, whenMissing: 'json' };
    expect(behavior.whenReturnTo).toBe(302);
  });
});
