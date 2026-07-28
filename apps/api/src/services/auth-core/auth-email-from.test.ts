import { describe, expect, test } from 'bun:test';

import { buildAuthEmailFromHeader } from './project-config.js';

describe('buildAuthEmailFromHeader (SuperTokens-style per-app From)', () => {
  test('Pando domain → Pando <noreply@pando.so>', () => {
    const from = buildAuthEmailFromHeader(
      {
        senderName: 'Pando',
        senderDomain: 'pando.so',
        senderLocalPart: null,
        senderEmail: null,
      },
      'briven.tech',
    );
    expect(from).toBe('Pando <noreply@pando.so>');
  });

  test('custom local part', () => {
    const from = buildAuthEmailFromHeader({
      senderName: 'Pando',
      senderDomain: 'pando.so',
      senderLocalPart: 'hello',
      senderEmail: null,
    });
    expect(from).toBe('Pando <hello@pando.so>');
  });

  test('full senderEmail wins over domain', () => {
    const from = buildAuthEmailFromHeader({
      senderName: 'mavi pay',
      senderDomain: 'ignored.com',
      senderLocalPart: null,
      senderEmail: 'auth@mavifinans.sh',
    });
    expect(from).toBe('"mavi pay" <auth@mavifinans.sh>');
  });

  test('spaces in name get quoted', () => {
    const from = buildAuthEmailFromHeader({
      senderName: 'mavi pay',
      senderDomain: 'mavifinans.sh',
      senderLocalPart: null,
      senderEmail: null,
    });
    expect(from).toBe('"mavi pay" <noreply@mavifinans.sh>');
  });

  test('name only (no domain) still rebrands display on platform mailbox', () => {
    const from = buildAuthEmailFromHeader(
      {
        senderName: 'Pando',
        senderDomain: null,
        senderLocalPart: null,
        senderEmail: null,
      },
      'briven.tech',
    );
    expect(from).toBe('Pando <noreply@briven.tech>');
  });

  test('default Briven Auth name without domain → null (use platform From)', () => {
    const from = buildAuthEmailFromHeader({
      senderName: 'Briven Auth',
      senderDomain: null,
      senderLocalPart: null,
      senderEmail: null,
    });
    expect(from).toBeNull();
  });

  test('rejects junk domain', () => {
    const from = buildAuthEmailFromHeader({
      senderName: 'X',
      senderDomain: 'not a domain!!!',
      senderLocalPart: null,
      senderEmail: null,
    });
    // falls back to name + platform domain
    expect(from).toBe('X <noreply@briven.tech>');
  });
});
