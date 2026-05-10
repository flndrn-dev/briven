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
