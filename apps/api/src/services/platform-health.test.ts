/**
 * Unit tests for the pure host-metrics logic in platform-health.ts —
 * the Prometheus instant-query parser. This is the load-bearing parse
 * that turns a node-exporter scrape into a number (or null), so it's
 * pinned in isolation against real-shaped Prometheus payloads. The
 * network + env-guard paths are exercised by the live deploy; this file
 * proves the HARD honesty rule: malformed/empty → null, never a fake 0.
 */

import { describe, expect, test } from 'bun:test';

import { parsePromSample } from './platform-health.js';

describe('parsePromSample', () => {
  test('parses a real instant-query vector → number + instance label', () => {
    const payload = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          {
            metric: { __name__: 'node_memory_MemTotal_bytes', instance: 'node-exporter:9100' },
            value: [1719500000, '16777216000'],
          },
        ],
      },
    };
    expect(parsePromSample(payload)).toEqual({
      value: 16777216000,
      instance: 'node-exporter:9100',
    });
  });

  test('parses a computed CPU-busy expression (decimal string, no instance)', () => {
    const payload = {
      status: 'success',
      data: { resultType: 'vector', result: [{ metric: {}, value: [1719500000, '42.5'] }] },
    };
    expect(parsePromSample(payload)).toEqual({ value: 42.5 });
  });

  test('empty result set → null (Prometheus up, metric absent)', () => {
    const payload = { status: 'success', data: { resultType: 'vector', result: [] } };
    expect(parsePromSample(payload)).toEqual({ value: null });
  });

  test('non-success status → null (never trusts an errored response)', () => {
    const payload = { status: 'error', errorType: 'bad_data', error: 'parse error' };
    expect(parsePromSample(payload)).toEqual({ value: null });
  });

  test('unparseable value string → null, not NaN', () => {
    const payload = {
      status: 'success',
      data: { resultType: 'vector', result: [{ metric: {}, value: [1719500000, 'NaN'] }] },
    };
    expect(parsePromSample(payload)).toEqual({ value: null });
  });

  test('garbage / non-object inputs → null without throwing', () => {
    expect(parsePromSample(null)).toEqual({ value: null });
    expect(parsePromSample(undefined)).toEqual({ value: null });
    expect(parsePromSample('not json')).toEqual({ value: null });
    expect(parsePromSample(42)).toEqual({ value: null });
    expect(parsePromSample({})).toEqual({ value: null });
  });

  test('uses the FIRST series when multiple hosts report (single-host summary)', () => {
    const payload = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          { metric: { instance: 'host-a:9100' }, value: [1, '100'] },
          { metric: { instance: 'host-b:9100' }, value: [1, '200'] },
        ],
      },
    };
    expect(parsePromSample(payload)).toEqual({ value: 100, instance: 'host-a:9100' });
  });
});

describe('host metric threshold → tone (HARD honesty: null stays "—")', () => {
  // Mirror of the cockpit's usage-tone mapping (see admin/health/page.tsx).
  // Kept side-by-side with a test so a threshold change shows up red.
  function usageTone(percent: number | null, redAt: number, amberAt: number) {
    if (percent === null) return 'muted';
    if (percent >= redAt) return 'error';
    if (percent >= amberAt) return 'warning';
    return 'success';
  }

  test('cpu/disk: >85 red, >70 amber, else green', () => {
    expect(usageTone(92, 85, 70)).toBe('error');
    expect(usageTone(85, 85, 70)).toBe('error');
    expect(usageTone(78, 85, 70)).toBe('warning');
    expect(usageTone(12, 85, 70)).toBe('success');
  });

  test('null → muted (renders "—", never a fake colour)', () => {
    expect(usageTone(null, 85, 70)).toBe('muted');
  });

  test('steal: >25 red', () => {
    expect(usageTone(40, 25, 10)).toBe('error');
    expect(usageTone(2, 25, 10)).toBe('success');
  });
});
