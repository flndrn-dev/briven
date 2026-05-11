/**
 * Shared build-identity resolver tests — pin the env→git→"dev"
 * fallback chain so every service (apps/api, apps/realtime,
 * apps/runtime) gets the same answer for `/info.buildSha`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { resolveBuildAtFromGit, resolveShaFromGit } from '@briven/shared';

describe('resolveShaFromGit', () => {
  let tmp: string;
  let gitDir: string;
  const SHA = 'a42bd57b3c1d8e2f4a6b7c9d0e1f2a3b4c5d6e7f';

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'briven-git-'));
    gitDir = join(tmp, '.git');
    mkdirSync(gitDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('returns null when .git/HEAD is missing (dev tarball case)', () => {
    expect(resolveShaFromGit(gitDir)).toBeNull();
  });

  test('resolves a detached HEAD (sha written directly)', () => {
    writeFileSync(join(gitDir, 'HEAD'), SHA + '\n');
    expect(resolveShaFromGit(gitDir)).toBe(SHA);
  });

  test('resolves a loose ref (refs/heads/main)', () => {
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    mkdirSync(join(gitDir, 'refs/heads'), { recursive: true });
    writeFileSync(join(gitDir, 'refs/heads/main'), SHA + '\n');
    expect(resolveShaFromGit(gitDir)).toBe(SHA);
  });

  test('falls back to packed-refs when loose ref is absent', () => {
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(
      join(gitDir, 'packed-refs'),
      `# pack-refs with: peeled fully-peeled sorted\n${SHA} refs/heads/main\n`,
    );
    expect(resolveShaFromGit(gitDir)).toBe(SHA);
  });

  test('skips comment + peeled lines in packed-refs', () => {
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(
      join(gitDir, 'packed-refs'),
      [
        '# pack-refs with: peeled fully-peeled sorted',
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef refs/heads/other',
        `${SHA} refs/heads/main`,
        '^cafebabecafebabecafebabecafebabecafebabe',
      ].join('\n') + '\n',
    );
    expect(resolveShaFromGit(gitDir)).toBe(SHA);
  });

  test('returns null on malformed sha (corrupted ref)', () => {
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    mkdirSync(join(gitDir, 'refs/heads'), { recursive: true });
    writeFileSync(join(gitDir, 'refs/heads/main'), 'not-a-sha\n');
    expect(resolveShaFromGit(gitDir)).toBeNull();
  });
});

describe('resolveBuildAtFromGit', () => {
  let tmp: string;
  let gitDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'briven-git-at-'));
    gitDir = join(tmp, '.git');
    mkdirSync(gitDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('returns ISO timestamp derived from HEAD mtime', () => {
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    const out = resolveBuildAtFromGit(gitDir);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const delta = Math.abs(Date.now() - new Date(out as string).getTime());
    expect(delta).toBeLessThan(5_000);
  });

  test('returns null when HEAD is absent', () => {
    expect(resolveBuildAtFromGit(gitDir)).toBeNull();
  });
});
