/**
 * Offline SMS honesty + email branding HTML (no Doltgres).
 * Full path: bun scripts/sms-polish-proof.mjs (needs local engine DB).
 */
import { describe, expect, test } from 'bun:test';

import {
  buildBrivenEngineAuthEmailHtml,
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

describe('briven-engine auth email branding HTML', () => {
  test('includes sender name, accent color, and escaped body', () => {
    const html = buildBrivenEngineAuthEmailHtml({
      body: 'Your code: 123456\nExpires soon.',
      branding: {
        logoUrl: null,
        primaryColor: '#FFFD74',
        senderName: 'Konnos',
      },
    });
    expect(html).toContain('Konnos');
    expect(html).toContain('#FFFD74');
    expect(html).toContain('Your code: 123456');
    expect(html).not.toContain('<script>');
  });

  test('escapes HTML in body and drops unsafe logo URLs', () => {
    const html = buildBrivenEngineAuthEmailHtml({
      body: '<b>hi</b>',
      branding: {
        logoUrl: 'https://example.com/x.png" onerror="alert(1)',
        primaryColor: '#112233',
        senderName: 'App <x>',
      },
    });
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(html).toContain('App &lt;x&gt;');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
  });
});

