import { describe, expect, test } from 'bun:test';

import { getAuthEmailDeliveryStatus } from './delivery.js';

describe('auth email delivery status (Phase 4)', () => {
  test('reports engine brand and transport shape', () => {
    const s = getAuthEmailDeliveryStatus();
    expect(s.engine).toBe('briven-engine');
    expect(['smtp', 'mittera', 'dev-stdout']).toContain(s.activeTransport);
    expect(typeof s.smtpConfigured).toBe('boolean');
    expect(typeof s.mitteraConfigured).toBe('boolean');
    expect(typeof s.fromAddress).toBe('string');
    expect(typeof s.realEmailLikely).toBe('boolean');
  });
});
