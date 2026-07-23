/**
 * Offline SMS honesty checks (no Doltgres).
 * Full path: bun scripts/sms-polish-proof.mjs (needs local engine DB).
 */
import { describe, expect, test } from 'bun:test';

import {
  sendBrivenEngineSms,
  sendBrivenEngineSmsTest,
} from './delivery.js';

describe('briven-engine SMS honest delivery (offline)', () => {
  test('test helper rejects non-E.164 phone without hitting provider', async () => {
    const r = await sendBrivenEngineSmsTest({
      projectId: 'p_any',
      phoneNumber: '5551234',
    });
    expect(r.ok).toBe(false);
    expect(r.mode).toBe('error');
    expect(r.message?.toLowerCase()).toContain('e.164');
  });

  test('SMS without projectId is not a silent success', async () => {
    const r = await sendBrivenEngineSms({
      phoneNumber: '+15551234567',
      userInputCode: '123456',
      type: 'PASSWORDLESS_LOGIN',
    });
    expect(r.ok).toBe(false);
    expect(r.mode).toBe('log');
    expect(r.channel).toBe('sms');
    expect(r.engine).toBe('briven-engine');
    expect(r.message?.toLowerCase()).toMatch(/project/);
  });
});
