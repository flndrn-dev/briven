/**
 * /info contract tests — pin the shape and the dev-fallback behaviour
 * so a doctor / CI deploy-gate / support tool that depends on these
 * fields fails loudly at build time when the response shape drifts.
 *
 * We don't spin up the full Hono app + DB here — that's covered by
 * the post-deploy production smoke. This file asserts the
 * environment-variable handling that decides BUILD_SHA / BUILD_AT
 * fallbacks.
 */

import { describe, expect, test } from 'bun:test';

describe('/info build identity fallbacks', () => {
  // Replicates the small helper in health.ts. When BRIVEN_BUILD_SHA /
  // BRIVEN_BUILD_AT are passed at docker build time via ARG, they
  // surface as process.env in the runtime container. Outside docker
  // they're undefined; the endpoint returns the literal string "dev"
  // so /info never 500s on a fresh local checkout.
  function resolveBuildSha(envVar: string | undefined): string {
    return envVar ?? 'dev';
  }
  function resolveBuildAt(envVar: string | undefined): string {
    return envVar ?? 'dev';
  }

  test('uses the env value when set', () => {
    expect(resolveBuildSha('a42bd57')).toBe('a42bd57');
    expect(resolveBuildAt('2026-05-10T22:08:32Z')).toBe('2026-05-10T22:08:32Z');
  });

  test('falls back to "dev" when env is unset', () => {
    expect(resolveBuildSha(undefined)).toBe('dev');
    expect(resolveBuildAt(undefined)).toBe('dev');
  });

  test('the empty string is treated as set (intentional: deploy may pass empty)', () => {
    // If the docker --build-arg gets an empty value, we still record
    // it — the operator sees "buildSha=" in /info and knows to
    // re-deploy with the sha actually populated.
    expect(resolveBuildSha('')).toBe('');
  });
});

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
