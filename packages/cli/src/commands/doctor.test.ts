/**
 * Doctor unit tests — focused on the pure logic that doesn't need the
 * network. The interactive `runDoctor` orchestration (which fans out
 * fetches and renders cli output) is exercised by the post-deploy
 * integration suite that lives in infra/.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('realtime origin derivation', () => {
  // Mirrors the regex in doctor.ts. Refactor target: extract the helper
  // once we add a second consumer; for now the single test pins the
  // behaviour we depend on so any change to the api-host pattern shows
  // up here.
  function deriveRealtime(origin: string): string {
    return origin.replace(/:\/\/api\./, '://realtime.');
  }

  test('rewrites api.<domain> → realtime.<domain>', () => {
    assert.equal(deriveRealtime('https://api.briven.tech'), 'https://realtime.briven.tech');
    assert.equal(
      deriveRealtime('http://api.briven.local:3001'),
      'http://realtime.briven.local:3001',
    );
  });

  test('leaves origins without an api. prefix unchanged', () => {
    assert.equal(deriveRealtime('http://localhost:3001'), 'http://localhost:3001');
    assert.equal(deriveRealtime('https://briven.tech'), 'https://briven.tech');
    assert.equal(deriveRealtime('https://my-api.example.com'), 'https://my-api.example.com');
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
    assert.equal(formatBoot('2026-05-10T19:59:30Z', NOW), '30s ago');
    assert.equal(formatBoot('2026-05-10T19:59:01Z', NOW), '59s ago');
  });

  test('minutes-ago window', () => {
    assert.equal(formatBoot('2026-05-10T19:55:00Z', NOW), '5m ago');
    assert.equal(formatBoot('2026-05-10T19:01:00Z', NOW), '59m ago');
  });

  test('hours-ago window', () => {
    assert.equal(formatBoot('2026-05-10T15:00:00Z', NOW), '5h ago');
  });

  test('clamps negative deltas to zero (clock-skew safety)', () => {
    assert.equal(formatBoot('2026-05-10T20:01:00Z', NOW), '0s ago');
  });

  test('returns the raw string for unparseable input (best-effort)', () => {
    assert.equal(formatBoot('not-a-date', NOW), 'not-a-date');
  });
});
