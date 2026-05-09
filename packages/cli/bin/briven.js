#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  let mod;
  try {
    mod = await import(pathToFileURL(resolve(here, '../dist/cli/index.js')).href);
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
      // Dev-from-source fallback: route the import through tsx's loader so
      // `.ts` files with `.js`-suffixed imports resolve correctly.
      const { tsImport } = await import('tsx/esm/api');
      mod = await tsImport(pathToFileURL(resolve(here, '../src/index.ts')).href, import.meta.url);
    } else {
      throw err;
    }
  }
  const code = await mod.run(process.argv.slice(2));
  process.exit(typeof code === 'number' ? code : 0);
}

main().catch((err) => {
  process.stderr.write(`briven: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
