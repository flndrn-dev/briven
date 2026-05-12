import { beforeEach, describe, expect, test } from 'bun:test';

import {
  _resetConnectionSecondsBaseline,
  diffConnectionSeconds,
  parseConnectionSecondsMetrics,
} from './connection-seconds.js';

describe('parseConnectionSecondsMetrics', () => {
  test('parses one project gauge', () => {
    const body = `# HELP briven_realtime_connection_seconds_total cumulative
# TYPE briven_realtime_connection_seconds_total gauge
briven_realtime_connection_seconds_total{project="p_abc123"} 42.5
`;
    const out = parseConnectionSecondsMetrics(body);
    expect(out.size).toBe(1);
    expect(out.get('p_abc123')).toBe(42.5);
  });

  test('parses multiple projects', () => {
    const body =
      'briven_realtime_connection_seconds_total{project="p_a"} 10\n' +
      'briven_realtime_connection_seconds_total{project="p_b"} 20\n' +
      'briven_realtime_connection_seconds_total{project="p_c"} 30.75\n';
    const out = parseConnectionSecondsMetrics(body);
    expect(out.size).toBe(3);
    expect(out.get('p_a')).toBe(10);
    expect(out.get('p_b')).toBe(20);
    expect(out.get('p_c')).toBe(30.75);
  });

  test('ignores comment lines, empty lines, and other metrics', () => {
    const body = `# HELP something else
# TYPE briven_realtime_subscriptions_active gauge
briven_realtime_subscriptions_active 5

briven_realtime_connection_seconds_total{project="p_x"} 7
briven_realtime_other_total{project="p_y"} 99
`;
    const out = parseConnectionSecondsMetrics(body);
    expect(out.size).toBe(1);
    expect(out.get('p_x')).toBe(7);
  });

  test('rejects negative or non-finite values', () => {
    const body =
      'briven_realtime_connection_seconds_total{project="p_a"} -1\n' +
      'briven_realtime_connection_seconds_total{project="p_b"} NaN\n' +
      'briven_realtime_connection_seconds_total{project="p_c"} 5\n';
    const out = parseConnectionSecondsMetrics(body);
    expect(out.size).toBe(1);
    expect(out.get('p_c')).toBe(5);
  });

  test('handles missing label brace gracefully', () => {
    const body = 'briven_realtime_connection_seconds_total 42\n';
    const out = parseConnectionSecondsMetrics(body);
    expect(out.size).toBe(0);
  });
});

describe('diffConnectionSeconds', () => {
  beforeEach(() => {
    _resetConnectionSecondsBaseline();
  });

  test('first scrape returns no deltas (baseline-only)', () => {
    const deltas = diffConnectionSeconds(new Map([['p_a', 100]]));
    expect(deltas.size).toBe(0);
  });

  test('second scrape returns the delta', () => {
    diffConnectionSeconds(new Map([['p_a', 100]]));
    const deltas = diffConnectionSeconds(new Map([['p_a', 175]]));
    expect(deltas.size).toBe(1);
    expect(deltas.get('p_a')).toBe(75);
  });

  test('counter going backwards (realtime restart) → current treated as delta', () => {
    diffConnectionSeconds(new Map([['p_a', 1000]]));
    const deltas = diffConnectionSeconds(new Map([['p_a', 10]]));
    // realtime restarted; we lost the seconds between 1000 (api-side
    // last-seen) and the restart, but the 10 seconds since restart are
    // surfaced as a delta so we don't drop them too.
    expect(deltas.get('p_a')).toBe(10);
  });

  test('zero delta is dropped (no row emitted)', () => {
    diffConnectionSeconds(new Map([['p_a', 50]]));
    const deltas = diffConnectionSeconds(new Map([['p_a', 50]]));
    expect(deltas.size).toBe(0);
  });

  test('multiple projects are tracked independently', () => {
    diffConnectionSeconds(
      new Map([
        ['p_a', 100],
        ['p_b', 200],
      ]),
    );
    const deltas = diffConnectionSeconds(
      new Map([
        ['p_a', 150], // +50
        ['p_b', 200], // 0 — drops
        ['p_c', 30], // new — baselines, drops
      ]),
    );
    expect(deltas.size).toBe(1);
    expect(deltas.get('p_a')).toBe(50);
  });
});
