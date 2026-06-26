import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectSchema } from './bundler.js';

/**
 * Write a throwaway project and run `fn` against it.
 *
 * `moduleType` controls the project's package.json `type` field, which is what
 * decides whether the loader's tsx import treats `briven/schema.ts` as
 * CommonJS or ESM — the exact axis the CJS/ESM interop unwrap exists for.
 */
async function withProject(
  source: string,
  moduleType: 'commonjs' | 'module',
  fn: (cwd: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'briven-bundler-'));
  try {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'tmp', type: moduleType }),
      'utf8',
    );
    await mkdir(join(dir, 'briven'), { recursive: true });
    await writeFile(join(dir, 'briven', 'schema.ts'), source, 'utf8');
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadProjectSchema returns null when schema.ts is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'briven-bundler-'));
  try {
    assert.equal(await loadProjectSchema(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadProjectSchema accepts a plain ESM default export', async () => {
  await withProject('export default { version: 1, tables: {} };\n', 'module', async (cwd) => {
    const schema = await loadProjectSchema(cwd);
    assert.equal(schema?.version, 1);
  });
});

test('loadProjectSchema unwraps the CJS/ESM double-default shape', async () => {
  // Bug repro: in a CommonJS project, `export default schema({...})` is
  // interop-double-wrapped to `mod.default.default`, so the loader used to
  // reject a perfectly valid schema with "is not a valid briven schema".
  await withProject('export default { version: 1, tables: {} };\n', 'commonjs', async (cwd) => {
    const schema = await loadProjectSchema(cwd);
    assert.equal(schema?.version, 1);
    assert.deepEqual(schema?.tables, {});
  });
});

test('loadProjectSchema rejects a non-schema default export', async () => {
  await withProject('export default { version: 2, tables: {} };\n', 'commonjs', async (cwd) => {
    await assert.rejects(loadProjectSchema(cwd), /not a valid briven schema/);
  });
});
