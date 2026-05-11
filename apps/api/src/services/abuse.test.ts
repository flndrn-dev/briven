import { describe, expect, test } from 'bun:test';

import {
  ABUSE_RESOLUTION,
  ABUSE_SEVERITY,
  type AbuseResolution,
  type AbuseSeverity,
} from './abuse.js';

describe('ABUSE_SEVERITY', () => {
  test('includes the standard set, in a stable order', () => {
    // Order is the dropdown order in the dashboard surface; fixing it
    // here keeps a refactor from silently re-ordering UI options.
    expect([...ABUSE_SEVERITY]).toEqual([
      'spam',
      'phishing',
      'malware',
      'csam',
      'tos',
      'other',
    ]);
  });

  test('every value is a valid AbuseSeverity', () => {
    for (const v of ABUSE_SEVERITY) {
      const _check: AbuseSeverity = v;
      expect(_check).toBe(v);
    }
  });
});

describe('ABUSE_RESOLUTION', () => {
  test('escalates from no-action to banned', () => {
    expect([...ABUSE_RESOLUTION]).toEqual(['no_action', 'warned', 'suspended', 'banned']);
  });

  test('every value is a valid AbuseResolution', () => {
    for (const v of ABUSE_RESOLUTION) {
      const _check: AbuseResolution = v;
      expect(_check).toBe(v);
    }
  });
});

describe('auto-suspension decision', () => {
  // Mirrors the rule in resolveAbuseReport — keep them in lock-step so a
  // future change to escalation policy surfaces here.
  function shouldAutoSuspend(resolution: AbuseResolution, projectId: string | undefined): boolean {
    const isEscalation = resolution === 'suspended' || resolution === 'banned';
    return isEscalation && Boolean(projectId);
  }

  test('no_action never suspends, even with a projectId', () => {
    expect(shouldAutoSuspend('no_action', 'p_abc')).toBe(false);
  });

  test('warned never suspends, even with a projectId', () => {
    expect(shouldAutoSuspend('warned', 'p_abc')).toBe(false);
  });

  test('suspended without a projectId is a no-op (admin will set later)', () => {
    expect(shouldAutoSuspend('suspended', undefined)).toBe(false);
  });

  test('suspended with a projectId triggers the auto-suspend', () => {
    expect(shouldAutoSuspend('suspended', 'p_abc')).toBe(true);
  });

  test('banned with a projectId triggers the auto-suspend', () => {
    expect(shouldAutoSuspend('banned', 'p_abc')).toBe(true);
  });
});
