#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
try {
  const mod = await import(pathToFileURL(resolve(here, '../dist/cli/index.js')).href);
  const code = await mod.run(process.argv.slice(2));
  process.exit(typeof code === 'number' ? code : 0);
} catch (err) {
  // Last-resort guard: print a friendly one-liner instead of dumping a raw
  // Node stack trace at the user. Real command errors are handled inside
  // each command; reaching here means something unexpected escaped.
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`briven: unexpected error: ${msg}\n`);
  process.exit(1);
}
