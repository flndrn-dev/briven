#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(resolve(here, '../dist/cli/index.js')).href);
const code = await mod.run(process.argv.slice(2));
process.exit(typeof code === 'number' ? code : 0);
