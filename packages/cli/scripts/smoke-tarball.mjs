#!/usr/bin/env node
// Builds, packs, and consumes the resulting tarball from a clean scratch dir.
// Catches the class of bug where source-tree dev works (tsx fallback in
// bin/briven.js) but a real install is broken — exact case that motivated this.
import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const cliDir = resolve(here, '..');
const distPack = resolve(cliDir, '../../dist-pack');

const log = (m) => process.stdout.write(`[smoke] ${m}\n`);
const die = (m) => {
  process.stderr.write(`[smoke] FAIL: ${m}\n`);
  process.exit(1);
};

log('building + packing');
execSync('pnpm pack:tarball', { cwd: cliDir, stdio: 'inherit' });

const tarballs = readdirSync(distPack)
  .filter((f) => f.startsWith('briven-cli-') && f.endsWith('.tgz'))
  .sort();
if (tarballs.length === 0) die(`no tarball found in ${distPack}`);
const tarball = join(distPack, tarballs[tarballs.length - 1]);
log(`tarball: ${tarball}`);

const scratch = mkdtempSync(join(tmpdir(), 'briven-cli-smoke-'));
log(`scratch: ${scratch}`);

const cleanup = () => rmSync(scratch, { recursive: true, force: true });
process.on('exit', cleanup);

writeFileSync(join(scratch, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
execSync(`npm install --silent --no-audit --no-fund "${tarball}"`, { cwd: scratch, stdio: 'inherit' });

log('checking briven --help');
const helpOut = execSync('./node_modules/.bin/briven --help', { cwd: scratch, encoding: 'utf8' });
if (!/briven/i.test(helpOut)) die(`--help output unexpected:\n${helpOut}`);

log('checking briven --version');
execSync('./node_modules/.bin/briven --version', { cwd: scratch, stdio: 'inherit' });

log('checking briven on unknown command exits 1');
let unknownExit = 0;
try {
  execSync('./node_modules/.bin/briven definitely-not-a-command', { cwd: scratch, stdio: 'pipe' });
} catch (e) {
  unknownExit = e.status ?? 0;
}
if (unknownExit !== 1) die(`unknown command exited ${unknownExit}, expected 1`);

log('checking sub-exports import cleanly');
writeFileSync(
  join(scratch, 'check.mjs'),
  [
    `import * as cli from '@briven/cli';`,
    `import * as schema from '@briven/cli/schema';`,
    `import * as server from '@briven/cli/server';`,
    `if (typeof cli.run !== 'function') { console.error('cli.run not exported'); process.exit(1); }`,
    `if (Object.keys(schema).length === 0) { console.error('schema export is empty'); process.exit(1); }`,
    `if (Object.keys(server).length === 0) { console.error('server export is empty'); process.exit(1); }`,
    `console.log('[smoke] sub-exports ok');`,
    ``,
  ].join('\n')
);
execSync('node check.mjs', { cwd: scratch, stdio: 'inherit' });

log('PASS');
