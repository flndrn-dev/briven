import { describe, expect, test } from 'bun:test';

import { passwordlessEmailDeliveryService, passwordlessSmsDeliveryService } from './delivery.js';

describe('briven-engine delivery services', () => {
  test('sms service exposes sendSms', () => {
    const s = passwordlessSmsDeliveryService();
    expect(typeof s.service.sendSms).toBe('function');
  });

  test('email service exposes sendEmail', () => {
    const s = passwordlessEmailDeliveryService();
    expect(typeof s.service.sendEmail).toBe('function');
  });

  test('sms send logs without throwing when no secrets', async () => {
    const s = passwordlessSmsDeliveryService();
    await s.service.sendSms({
      phoneNumber: '+15550001111',
      userInputCode: '123456',
      type: 'PASSWORDLESS_LOGIN',
    });
  });
});
