import { describe, expect, test } from 'bun:test';

import { resolveWebAuthnRp, rpIdMatchesOrigin } from './webauthn.js';

describe('rpIdMatchesOrigin', () => {
  test('exact host match', () => {
    expect(rpIdMatchesOrigin('pay.mavifinans.sh', 'https://pay.mavifinans.sh')).toBe(
      true,
    );
  });
  test('parent domain allowed', () => {
    expect(rpIdMatchesOrigin('mavifinans.sh', 'https://pay.mavifinans.sh')).toBe(true);
  });
  test('unrelated domain rejected', () => {
    expect(rpIdMatchesOrigin('briven.tech', 'https://pay.mavifinans.sh')).toBe(false);
  });
});

describe('resolveWebAuthnRp', () => {
  test('uses request Origin for tenant app (not briven.tech)', async () => {
    const r = await resolveWebAuthnRp({
      // no project → no Allowed Domains; request origin wins
      requestOrigin: 'https://pay.mavifinans.sh',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rpId).toBe('pay.mavifinans.sh');
    expect(r.expectedOrigin).toBe('https://pay.mavifinans.sh');
  });

  test('explicit app rpId + origin', async () => {
    const r = await resolveWebAuthnRp({
      rpId: 'pay.mavifinans.sh',
      expectedOrigin: 'https://pay.mavifinans.sh',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rpId).toBe('pay.mavifinans.sh');
  });

  test('ignores mismatched client rpId (briven.tech on mavi host)', async () => {
    const r = await resolveWebAuthnRp({
      rpId: 'briven.tech',
      expectedOrigin: 'https://pay.mavifinans.sh',
      requestOrigin: 'https://pay.mavifinans.sh',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rpId).toBe('pay.mavifinans.sh');
  });
});
