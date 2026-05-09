import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Bundle } from './types.js';

export interface MaterializerConfig {
  /** Base directory for isolate working dirs, e.g. '/tmp'. */
  isolateBaseDir: string;
  /** Directory containing the host-vendored loop.ts/server.ts/types.ts files. */
  runtimeStubDir: string;
}

export interface MaterializeResult {
  /** /tmp/briven-isolate-<id> */
  tmpDir: string;
  /** <tmpDir>/__entry.ts */
  entryPath: string;
  /** <tmpDir>/import-map.json */
  importMapPath: string;
}

const ISOLATE_PREFIX = 'briven-isolate-';

/**
 * Materialize the per-isolate tmp dir layout:
 *
 *   /tmp/briven-isolate-<id>/
 *   ├── .briven-runtime/         # host-vendored, never customer-controlled
 *   │   ├── server.ts
 *   │   ├── loop.ts
 *   │   └── types.ts
 *   ├── briven/functions/        # customer files, copied from bundle.directory
 *   ├── import-map.json          # @briven/cli/server → .briven-runtime/server.ts
 *   └── __entry.ts               # host-generated dispatch + loop kickoff
 *
 * The isolate's `--allow-read` and `--allow-write` permissions are scoped
 * to <tmpDir> only (CLAUDE.md §7.3).
 */
export async function materializeIsolate(
  isolateId: string,
  bundle: Bundle,
  config: MaterializerConfig,
): Promise<MaterializeResult> {
  const tmpDir = join(config.isolateBaseDir, `${ISOLATE_PREFIX}${isolateId}`);
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  // .briven-runtime/ — copy loop.ts, server.ts, types.ts verbatim
  const stubDir = join(tmpDir, '.briven-runtime');
  await mkdir(stubDir, { recursive: true });
  for (const f of ['loop.ts', 'server.ts', 'types.ts']) {
    await copyFile(join(config.runtimeStubDir, f), join(stubDir, f));
  }

  // briven/functions/ — copy each function source from bundle.directory
  const fnDir = join(tmpDir, 'briven', 'functions');
  await mkdir(fnDir, { recursive: true });
  for (const name of bundle.functionNames) {
    const src = join(bundle.directory, 'functions', `${name}.ts`);
    const dest = join(fnDir, `${name}.ts`);
    await copyFile(src, dest);
  }

  // import-map.json — single mapping for the @briven/cli/server stub
  const importMap = {
    imports: {
      '@briven/cli/server': './.briven-runtime/server.ts',
    },
  };
  const importMapPath = join(tmpDir, 'import-map.json');
  await writeFile(importMapPath, JSON.stringify(importMap, null, 2));

  // __entry.ts — host-generated dispatch table + loop kickoff
  const entryPath = join(tmpDir, '__entry.ts');
  await writeFile(entryPath, generateEntry(bundle));

  return { tmpDir, entryPath, importMapPath };
}

function generateEntry(bundle: Bundle): string {
  const imports = bundle.functionNames
    .map((n, i) => `import * as fn${i} from './briven/functions/${n}.ts';`)
    .join('\n');
  const dispatchAssigns = bundle.functionNames
    .map((n, i) => `dispatch.${n} = (fn${i} as any).${n} ?? (fn${i} as any).default;`)
    .join('\n');
  return `// host-generated entry
import { runIsolateLoop } from './.briven-runtime/loop.ts';
${imports}

const dispatch: Record<string, (ctx: any, args: any) => unknown> = {};
${dispatchAssigns}

await runIsolateLoop(dispatch, ${JSON.stringify(bundle.deploymentId)});
`;
}

export async function cleanupIsolate(tmpDir: string): Promise<void> {
  await rm(tmpDir, { recursive: true, force: true });
}

/**
 * Remove every `briven-isolate-*` directory under `isolateBaseDir` whose
 * id is not in `liveIsolateIds`. Used at startup to clear orphans left by
 * a previous host process, and after a host-cap eviction.
 */
export async function sweepOrphans(
  isolateBaseDir: string,
  liveIsolateIds: ReadonlySet<string>,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(isolateBaseDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(ISOLATE_PREFIX)) continue;
    const id = entry.slice(ISOLATE_PREFIX.length);
    if (liveIsolateIds.has(id)) continue;
    await rm(join(isolateBaseDir, entry), { recursive: true, force: true }).catch(() => {});
  }
}
