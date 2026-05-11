/**
 * /info + /ready contract tests for apps/api — pin the readiness gate
 * logic so the matrix of (configured? × reachable?) stays testable
 * without standing up postgres / redis. Build-identity resolution is
 * exercised by packages/shared/src/build-identity.test.ts since the
 * resolver lives there now.
 */

import { describe, expect, test } from 'bun:test';

describe('/ready check states', () => {
  // Mirrors the ready endpoint's check projection. Decoupling the
  // pure logic here makes the matrix of (configured? × reachable?)
  // testable without standing up postgres / redis.
  function checkState(args: {
    configured: boolean;
    reachable: boolean;
  }): 'ok' | 'unreachable' | 'not_configured' {
    if (!args.configured) return 'not_configured';
    return args.reachable ? 'ok' : 'unreachable';
  }

  test('configured + reachable → ok', () => {
    expect(checkState({ configured: true, reachable: true })).toBe('ok');
  });

  test('configured + unreachable → unreachable', () => {
    expect(checkState({ configured: true, reachable: false })).toBe('unreachable');
  });

  test('not configured → not_configured regardless of reachable', () => {
    expect(checkState({ configured: false, reachable: false })).toBe('not_configured');
    expect(checkState({ configured: false, reachable: true })).toBe('not_configured');
  });
});

describe('redis-required readiness gate', () => {
  // Redis is required when configured (logs streaming + rate-limit
  // hard-depend on it) but optional in dev mode. The /ready endpoint
  // 503s only when configured-AND-unreachable; an unconfigured deploy
  // ack 200 to let dev workflows keep moving.
  function isReady(args: {
    controlOk: boolean;
    dataOk: boolean;
    runtimeOk: boolean;
    redisConfigured: boolean;
    redisOk: boolean;
  }): boolean {
    const required =
      args.controlOk && args.dataOk && args.runtimeOk && (!args.redisConfigured || args.redisOk);
    return required;
  }

  test('all healthy + redis configured ok → ready', () => {
    expect(
      isReady({
        controlOk: true,
        dataOk: true,
        runtimeOk: true,
        redisConfigured: true,
        redisOk: true,
      }),
    ).toBe(true);
  });

  test('redis unconfigured + everything else ok → ready (dev mode)', () => {
    expect(
      isReady({
        controlOk: true,
        dataOk: true,
        runtimeOk: true,
        redisConfigured: false,
        redisOk: false,
      }),
    ).toBe(true);
  });

  test('redis configured + unreachable → NOT ready', () => {
    expect(
      isReady({
        controlOk: true,
        dataOk: true,
        runtimeOk: true,
        redisConfigured: true,
        redisOk: false,
      }),
    ).toBe(false);
  });

  test('control plane down → NOT ready regardless of redis', () => {
    expect(
      isReady({
        controlOk: false,
        dataOk: true,
        runtimeOk: true,
        redisConfigured: false,
        redisOk: false,
      }),
    ).toBe(false);
  });
});
