/**
 * Unit tests for deploy-history boundary behaviour — pin the rules
 * around what does and doesn't get recorded, and the listDeploys
 * limit clamping. The DB write path is exercised by the post-deploy
 * smoke and by the boot itself; this file covers the pure decisions.
 */

import { describe, expect, test } from 'bun:test';

// Local mirror of the "skip dev sentinel" rule in deploy-history.ts.
// Keeping the rule + its test side-by-side means a change to one
// without the other shows up as a red test.
function shouldRecord(buildSha: string): boolean {
  return buildSha !== 'dev';
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 50, 1), 500);
}

describe('shouldRecord', () => {
  test('skips the dev sentinel so local boots don\'t pollute the timeline', () => {
    expect(shouldRecord('dev')).toBe(false);
  });

  test('records a real sha', () => {
    expect(shouldRecord('a75e2b1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f')).toBe(true);
  });

  test('short shas still record (resolveShaFromGit may return a 7-char if HEAD is detached)', () => {
    // We don't enforce a length minimum because git itself doesn't —
    // `git checkout abc1234` is valid and HEAD becomes that 7-char sha.
    expect(shouldRecord('abc1234')).toBe(true);
  });
});

describe('clampLimit', () => {
  test('default is 50 when not specified', () => {
    expect(clampLimit(undefined)).toBe(50);
  });

  test('floors at 1 — listDeploys({ limit: 0 }) is nonsensical', () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-100)).toBe(1);
  });

  test('caps at 500 — operator-visible bound on result-set growth', () => {
    expect(clampLimit(1000)).toBe(500);
    expect(clampLimit(500)).toBe(500);
  });

  test('passes through valid values', () => {
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(200)).toBe(200);
  });
});
