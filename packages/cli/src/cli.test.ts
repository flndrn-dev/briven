import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { run } from './index.js';

describe('@briven/cli entry', () => {
  let tempDir: string;
  let prevXdg: string | undefined;

  before(async () => {
    // Isolate from the developer's real ~/.config/briven so "no credentials"
    // assertions stay deterministic.
    prevXdg = process.env.XDG_CONFIG_HOME;
    tempDir = await mkdtemp(join(tmpdir(), 'briven-cli-test-'));
    process.env.XDG_CONFIG_HOME = tempDir;
  });

  after(async () => {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('exports run()', () => {
    assert.equal(typeof run, 'function');
  });

  it('returns 0 for --help', async () => {
    const code = await run(['--help']);
    assert.equal(code, 0);
  });

  it('returns 1 for an unknown command', async () => {
    const code = await run(['definitely-not-a-command']);
    assert.equal(code, 1);
  });

  it('returns 0 for "link --help"', async () => {
    const code = await run(['link', '--help']);
    assert.equal(code, 0);
  });

  it('returns 1 for "link" with no briven.json in cwd', async () => {
    // The CLI workspace root has no briven.json (it's a package, not a briven
    // project), so this exercises the "no briven.json" guard end-to-end.
    const code = await run(['link']);
    assert.equal(code, 1);
  });

  it('returns 0 for "invoke --help"', async () => {
    const code = await run(['invoke', '--help']);
    assert.equal(code, 0);
  });

  it('returns 1 for "invoke" with no function name', async () => {
    const code = await run(['invoke']);
    assert.equal(code, 1);
  });

  it('returns 1 for "invoke <name>" with invalid --body json', async () => {
    const code = await run(['invoke', 'someFn', '--body', '{not-json']);
    assert.equal(code, 1);
  });

  it('returns 1 for "invoke <name>" with no linked project', async () => {
    // No briven.json + no default credential → exits before any network call.
    const code = await run(['invoke', 'someFn']);
    assert.equal(code, 1);
  });

  it('returns 0 for "connect --help"', async () => {
    const code = await run(['connect', '--help']);
    assert.equal(code, 0);
  });

  it('returns 0 for "connect status" without a session', async () => {
    const code = await run(['connect', 'status']);
    assert.equal(code, 0);
  });

  it('returns 0 for "projects --help"', async () => {
    const code = await run(['projects', '--help']);
    assert.equal(code, 0);
  });

  it('returns 0 for "projects list" (works against an empty creds file)', async () => {
    const code = await run(['projects', 'list']);
    assert.equal(code, 0);
  });

  it('returns 1 for "projects set-default" without an argument', async () => {
    const code = await run(['projects', 'set-default']);
    assert.equal(code, 1);
  });

  it('returns 1 for "projects create" without --name', async () => {
    const code = await run(['projects', 'create']);
    assert.equal(code, 1);
  });

  it('returns 1 for "projects use" without a project id', async () => {
    const code = await run(['projects', 'use']);
    assert.equal(code, 1);
  });

  it('returns 1 for "projects unlink" without a project id', async () => {
    const code = await run(['projects', 'unlink']);
    assert.equal(code, 1);
  });

  it('returns 0 for "export --help"', async () => {
    const code = await run(['export', '--help']);
    assert.equal(code, 0);
  });

  it('returns 1 for "export" with no linked project', async () => {
    const code = await run(['export']);
    assert.equal(code, 1);
  });

  it('returns 0 for "import --help"', async () => {
    const code = await run(['import', '--help']);
    assert.equal(code, 0);
  });

  it('returns 1 for "import" with no path argument', async () => {
    const code = await run(['import']);
    assert.equal(code, 1);
  });
});
