import { readdir, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

import type { SchemaDef } from '@briven/schema';

/**
 * Load the user's `briven/schema.ts` from disk and return the resolved
 * `SchemaDef` value. Uses tsx's programmatic ESM API so we don't need the
 * user's project to be pre-compiled.
 *
 * Returns `null` if the file is missing; throws on a malformed default export.
 */
export async function loadProjectSchema(cwd: string): Promise<SchemaDef | null> {
  const path = resolve(cwd, 'briven', 'schema.ts');
  try {
    await stat(path);
  } catch {
    return null;
  }

  const tsx = await import('tsx/esm/api');
  const mod = (await tsx.tsImport(pathToFileURL(path).href, import.meta.url)) as {
    default?: unknown;
  };
  if (!mod.default || typeof mod.default !== 'object') {
    throw new Error('briven/schema.ts must have a default export produced by `schema(...)`');
  }
  const candidate = mod.default as Partial<SchemaDef>;
  if (candidate.version !== 1 || typeof candidate.tables !== 'object') {
    throw new Error('default export is not a valid briven schema');
  }
  return candidate as SchemaDef;
}

export interface FunctionInfo {
  readonly names: readonly string[];
  readonly count: number;
}

/**
 * List the user's function files. A function file is any `.ts` file under
 * `briven/functions/` — we key deployment identity on the list of file
 * basenames, which maps 1:1 to endpoint names in the runtime.
 */
export async function discoverFunctions(cwd: string): Promise<FunctionInfo> {
  const dir = resolve(cwd, 'briven', 'functions');
  const names: string[] = [];
  try {
    await walk(dir, dir, names);
  } catch (err) {
    if (isNotFound(err)) return { names: [], count: 0 };
    throw err;
  }
  names.sort();
  return { names, count: names.length };
}

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, root, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue;
    out.push(full.slice(root.length + 1));
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}
