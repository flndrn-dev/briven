/**
 * Offline SMS honesty + email branding HTML (no Doltgres).
 * Full path: bun scripts/sms-polish-proof.mjs (needs local engine DB).
 */
import { describe, expect, test } from 'bun:test';

import {
  authEmailSubject,
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
  test('includes sender name, custom footer, and structured OTP', () => {
    const html = buildBrivenEngineAuthEmailHtml({
      code: '123456',
      expiryMinutes: 10,
      branding: {
        logoUrl: null,
        primaryColor: '#FFFD74',
        senderName: 'Konnos',
        brandUrl: 'konnos.org',
        footerNote: null,
        footerLoveName: 'Flanders',
        footerOrgName: 'flndrn',
        footerTagline: '100% self-funded, sustainable & independent',
        footerCity: 'Limassol',
        footerCountry: 'Cyprus',
        footerShowLove: true,
        footerShowTagline: true,
        footerShowAddress: true,
      },
    });
    expect(html).toContain('Konnos');
    expect(html).toContain('sign in to Konnos');
    expect(html).toContain('123456');
    expect(html).toContain('Flanders');
    expect(html).toContain('Limassol');
    expect(html).toContain('self-funded');
    expect(html).toContain('konnos.org');
    expect(html).not.toContain('<script>');
  });

  test('omits footer lines when toggles are off', () => {
    const html = buildBrivenEngineAuthEmailHtml({
      code: '1',
      branding: {
        logoUrl: null,
        primaryColor: '#FFFD74',
        senderName: 'Mavi',
        brandUrl: null,
        footerNote: null,
        footerLoveName: 'Flanders',
        footerOrgName: 'flndrn',
        footerTagline: 'tagline',
        footerCity: 'Limassol',
        footerCountry: 'Cyprus',
        footerShowLove: false,
        footerShowTagline: false,
        footerShowAddress: false,
      },
    });
    expect(html).toContain('Mavi');
    expect(html).not.toContain('Flanders');
    expect(html).not.toContain('tagline');
    expect(html).not.toContain('Limassol');
  });

  test('magic link renders CTA; unsafe logo URLs dropped', () => {
    const html = buildBrivenEngineAuthEmailHtml({
      url: 'https://app.example.com/verify?t=1',
      branding: {
        logoUrl: 'https://example.com/x.png" onerror="alert(1)',
        primaryColor: '#112233',
        senderName: 'App <x>',
        brandUrl: null,
        footerNote: null,
        footerLoveName: null,
        footerOrgName: null,
        footerTagline: null,
        footerCity: null,
        footerCountry: null,
        footerShowLove: false,
        footerShowTagline: false,
        footerShowAddress: false,
      },
    });
    expect(html).toContain('https://app.example.com/verify?t=1');
    expect(html).toContain('click the button below to sign in');
    expect(html).toContain('App &lt;x&gt;');
    expect(html).not.toContain('onerror');
    // Unsafe logo rejected → colored circle, no img
    expect(html).not.toContain('<img');
    // No raw "Magic link:" dump — button only
    expect(html).not.toContain('Magic link:');
  });

  test('OTP-only email has code and no magic-link CTA', () => {
    const html = buildBrivenEngineAuthEmailHtml({
      code: '847291',
      branding: {
        logoUrl: null,
        primaryColor: '#0ea5e9',
        senderName: 'mavi pay',
        brandUrl: 'pay.mavifinans.sh',
        footerNote: null,
        footerLoveName: null,
        footerOrgName: null,
        footerTagline: null,
        footerCity: null,
        footerCountry: null,
        footerShowLove: false,
        footerShowTagline: false,
        footerShowAddress: false,
      },
    });
    expect(html).toContain('mavi pay');
    expect(html).toContain('847291');
    expect(html).toContain('enter this code');
    expect(html).not.toContain('click the button below');
    expect(html).not.toContain('Magic link');
  });

  test('authEmailSubject uses project name not Briven Auth', () => {
    expect(authEmailSubject('mavi pay', 'sign-in')).toBe(
      'Your mavi pay Auth sign-in',
    );
    expect(authEmailSubject('mavi pay', 'code', '123456')).toBe(
      'Your mavi pay Auth code: 123456',
    );
    expect(authEmailSubject('mavi pay', 'code')).toBe(
      'Your mavi pay Auth code',
    );
  });

  test('escapes plain body fallback', () => {
    const html = buildBrivenEngineAuthEmailHtml({
      body: '<b>hi</b>',
      branding: {
        logoUrl: null,
        primaryColor: '#112233',
        senderName: 'App',
        brandUrl: null,
        footerNote: null,
        footerLoveName: null,
        footerOrgName: null,
        footerTagline: null,
        footerCity: null,
        footerCountry: null,
        footerShowLove: false,
        footerShowTagline: false,
        footerShowAddress: false,
      },
    });
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
  });
});

