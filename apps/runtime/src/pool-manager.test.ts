import { describe, expect, test } from 'bun:test';

import {
  computeKillReason,
  IsolatePoolImpl,
  transitionState,
  type IsolateEntry,
} from './pool-manager.js';

const baseEntry: IsolateEntry = {
  isolateId: 'iso-1',
  projectId: 'p1',
  deploymentId: 'd1',
  state: 'ready',
  pid: 1234,
  invocationCount: 0,
  lastActivityAt: Date.now(),
  tmpDir: '/tmp/briven-isolate-iso-1',
  createdAt: Date.now(),
  consecutiveCrashes: 0,
  envValues: [],
};

describe('pool-manager state transitions', () => {
  test('ready → in_flight on invoke start', () => {
    expect(transitionState(baseEntry, { kind: 'invoke_start' }).state).toBe('in_flight');
  });

  test('in_flight → ready on invoke complete', () => {
    const inFlight = { ...baseEntry, state: 'in_flight' as const };
    expect(transitionState(inFlight, { kind: 'invoke_complete' }).state).toBe('ready');
  });

  test('any → retiring on retire signal', () => {
    expect(transitionState(baseEntry, { kind: 'retire' }).state).toBe('retiring');
  });

  test('any → dead on crash', () => {
    expect(transitionState(baseEntry, { kind: 'crash' }).state).toBe('dead');
  });
});

describe('pool-manager kill reason', () => {
  test('idle for >threshold returns idle', () => {
    const old = { ...baseEntry, lastActivityAt: Date.now() - 11 * 60_000 };
    expect(computeKillReason(old, { idleKillMs: 10 * 60_000, maxInvocations: 1000 })).toBe('idle');
  });

  test('invocationCount === max returns max_invocations', () => {
    const maxed = { ...baseEntry, invocationCount: 1000 };
    expect(computeKillReason(maxed, { idleKillMs: 10 * 60_000, maxInvocations: 1000 })).toBe('max_invocations');
  });

  test('healthy ready returns null', () => {
    expect(computeKillReason(baseEntry, { idleKillMs: 10 * 60_000, maxInvocations: 1000 })).toBeNull();
  });
});

describe('crash loop breaker', () => {
  test('records and breaks at threshold within window', () => {
    const pool = new IsolatePoolImpl({
      spawn: (async () => {
        throw new Error('not used');
      }) as never,
      runtimeStubDir: '/tmp/stub',
      isolateBaseDir: '/tmp',
      maxIsolates: 50,
      maxMemoryMb: 128,
      invocationTimeoutMs: 30_000,
      idleKillMs: 10 * 60_000,
      maxInvocationsPerIsolate: 1000,
      crashLoopThreshold: 3,
      crashLoopWindowMs: 60_000,
      runQueryProxy: async () => [],
      onLog: () => {},
      loadProjectEnv: async () => ({}),
    });
    const p = pool as unknown as {
      recordCrash: (k: string) => void;
      isCrashLoopBroken: (k: string) => boolean;
    };
    p.recordCrash('p1:d1');
    p.recordCrash('p1:d1');
    expect(p.isCrashLoopBroken('p1:d1')).toBe(false);
    p.recordCrash('p1:d1');
    expect(p.isCrashLoopBroken('p1:d1')).toBe(true);
  });

  test('out-of-window crashes are trimmed', () => {
    const pool = new IsolatePoolImpl({
      spawn: (async () => {
        throw new Error('not used');
      }) as never,
      runtimeStubDir: '/tmp/stub',
      isolateBaseDir: '/tmp',
      maxIsolates: 50,
      maxMemoryMb: 128,
      invocationTimeoutMs: 30_000,
      idleKillMs: 10 * 60_000,
      maxInvocationsPerIsolate: 1000,
      crashLoopThreshold: 3,
      crashLoopWindowMs: 50, // tiny window
      runQueryProxy: async () => [],
      onLog: () => {},
      loadProjectEnv: async () => ({}),
    });
    const p = pool as unknown as {
      recordCrash: (k: string) => void;
      isCrashLoopBroken: (k: string) => boolean;
    };
    p.recordCrash('p1:d1');
    p.recordCrash('p1:d1');
    p.recordCrash('p1:d1');
    expect(p.isCrashLoopBroken('p1:d1')).toBe(true);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(p.isCrashLoopBroken('p1:d1')).toBe(false); // trimmed
        resolve();
      }, 100);
    });
  });
});
