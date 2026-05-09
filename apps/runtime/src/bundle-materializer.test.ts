import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

import {
  cleanupIsolate,
  materializeIsolate,
  sweepOrphans,
  type MaterializerConfig,
} from './bundle-materializer.js';
import type { Bundle } from './types.js';

describe('bundle-materializer', () => {
  let workTmp: string;
  let bundleDir: string;
  let isolateBase: string;
  let runtimeStubDir: string;

  beforeEach(async () => {
    workTmp = await mkdtemp(join(tmpdir(), 'briven-mtest-'));
    bundleDir = join(workTmp, 'bundle');
    isolateBase = join(workTmp, 'isolates');
    runtimeStubDir = join(workTmp, 'stub');
    await mkdir(join(bundleDir, 'functions'), { recursive: true });
    await writeFile(
      join(bundleDir, 'functions', 'poolStats.ts'),
      'export const poolStats = () => 1;\n',
    );
    await mkdir(runtimeStubDir, { recursive: true });
    await writeFile(join(runtimeStubDir, 'loop.ts'), '// loop stub\n');
    await writeFile(join(runtimeStubDir, 'server.ts'), '// server stub\n');
    await writeFile(join(runtimeStubDir, 'types.ts'), '// types stub\n');
    await mkdir(isolateBase, { recursive: true });
  });

  afterEach(async () => {
    await rm(workTmp, { recursive: true, force: true });
  });

  test('materializes /tmp/briven-isolate-<id>/ layout', async () => {
    const bundle: Bundle = {
      projectId: 'p1',
      deploymentId: 'd1',
      functionNames: ['poolStats'],
      directory: bundleDir,
    };
    const config: MaterializerConfig = { isolateBaseDir: isolateBase, runtimeStubDir };
    const result = await materializeIsolate('iso-abc', bundle, config);

    expect(result.tmpDir).toBe(join(isolateBase, 'briven-isolate-iso-abc'));
    expect(result.entryPath).toBe(join(result.tmpDir, '__entry.ts'));
    expect(result.importMapPath).toBe(join(result.tmpDir, 'import-map.json'));

    const entryContent = await readFile(result.entryPath, 'utf8');
    expect(entryContent).toContain("import * as fn0 from './briven/functions/poolStats.ts';");
    expect(entryContent).toContain('dispatch.poolStats =');
    expect(entryContent).toContain("runIsolateLoop(dispatch, \"d1\")");

    const importMap = JSON.parse(await readFile(result.importMapPath, 'utf8'));
    expect(importMap.imports['@briven/cli/server']).toBe('./.briven-runtime/server.ts');

    const fn = await readFile(
      join(result.tmpDir, 'briven', 'functions', 'poolStats.ts'),
      'utf8',
    );
    expect(fn).toContain('export const poolStats');

    const loopStub = await readFile(
      join(result.tmpDir, '.briven-runtime', 'loop.ts'),
      'utf8',
    );
    expect(loopStub).toBe('// loop stub\n');
  });

  test('cleanupIsolate removes the tmp dir', async () => {
    const bundle: Bundle = {
      projectId: 'p1',
      deploymentId: 'd1',
      functionNames: [],
      directory: bundleDir,
    };
    const config: MaterializerConfig = { isolateBaseDir: isolateBase, runtimeStubDir };
    const result = await materializeIsolate('iso-x', bundle, config);
    await cleanupIsolate(result.tmpDir);
    expect(await pathExists(join(result.tmpDir, '__entry.ts'))).toBe(false);
    expect(await pathExists(result.tmpDir)).toBe(false);
  });

  test('sweepOrphans removes briven-isolate-* dirs not in the live set', async () => {
    await mkdir(join(isolateBase, 'briven-isolate-stale1'), { recursive: true });
    await mkdir(join(isolateBase, 'briven-isolate-live1'), { recursive: true });
    await mkdir(join(isolateBase, 'unrelated-dir'), { recursive: true });
    await sweepOrphans(isolateBase, new Set(['live1']));
    expect(await pathExists(join(isolateBase, 'briven-isolate-stale1'))).toBe(false);
    expect(await pathExists(join(isolateBase, 'briven-isolate-live1'))).toBe(true);
    expect(await pathExists(join(isolateBase, 'unrelated-dir'))).toBe(true);
  });
});
