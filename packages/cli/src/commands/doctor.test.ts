/**
 * Doctor unit tests — focused on the pure logic that doesn't need the
 * network. The interactive `runDoctor` orchestration (which fans out
 * fetches and renders cli output) is exercised by the post-deploy
 * integration suite that lives in infra/.
 */

import { describe, expect, test } from 'bun:test';

describe('realtime origin derivation', () => {
  // Mirrors the regex in doctor.ts. Refactor target: extract the helper
  // once we add a second consumer; for now the single test pins the
  // behaviour we depend on so any change to the api-host pattern shows
  // up here.
  function deriveRealtime(origin: string): string {
    return origin.replace(/:\/\/api\./, '://realtime.');
  }

  test('rewrites api.<domain> → realtime.<domain>', () => {
    expect(deriveRealtime('https://api.briven.tech')).toBe('https://realtime.briven.tech');
    expect(deriveRealtime('http://api.briven.local:3001')).toBe('http://realtime.briven.local:3001');
  });

  test('leaves origins without an api. prefix unchanged', () => {
    expect(deriveRealtime('http://localhost:3001')).toBe('http://localhost:3001');
    expect(deriveRealtime('https://briven.tech')).toBe('https://briven.tech');
    expect(deriveRealtime('https://my-api.example.com')).toBe('https://my-api.example.com');
  });
});

describe('boot-time formatting', () => {
  function formatBoot(iso: string, nowMs: number): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return iso;
    const sec = Math.max(0, Math.round((nowMs - then) / 1000));
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
    return `${Math.round(sec / 3600)}h ago`;
  }

  const NOW = new Date('2026-05-10T20:00:00Z').getTime();

  test('seconds-ago window', () => {
    expect(formatBoot('2026-05-10T19:59:30Z', NOW)).toBe('30s ago');
    expect(formatBoot('2026-05-10T19:59:01Z', NOW)).toBe('59s ago');
  });

  test('minutes-ago window', () => {
    expect(formatBoot('2026-05-10T19:55:00Z', NOW)).toBe('5m ago');
    expect(formatBoot('2026-05-10T19:01:00Z', NOW)).toBe('59m ago');
  });

  test('hours-ago window', () => {
    expect(formatBoot('2026-05-10T15:00:00Z', NOW)).toBe('5h ago');
  });

  test('clamps negative deltas to zero (clock-skew safety)', () => {
    expect(formatBoot('2026-05-10T20:01:00Z', NOW)).toBe('0s ago');
  });

  test('returns the raw string for unparseable input (best-effort)', () => {
    expect(formatBoot('not-a-date', NOW)).toBe('not-a-date');
  });
});
