#!/usr/bin/env node
/**
 * Post-process tsup DTS output — inline workspace-only type re-exports.
 *
 * tsup's `dts.resolve` option can't reliably resolve types from
 * workspace packages whose `exports.types` points at built `.d.ts`
 * files. The JS bundle is fine (tsup's `noExternal` inlines that
 * correctly); only the emitted `.d.ts` files are affected.
 *
 * This script reads the re-export stubs tsup emits and replaces them
 * with the actual type declarations from the workspace package, so
 * TypeScript consumers outside the monorepo get fully self-contained
 * type definitions.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Each entry: [distRelativePath, searchRegex, sourcePackageName]
const REPLACEMENTS = [
  [
    'dist/schema/index.d.ts',
    "export \\* from '@briven/schema';",
    '@briven/schema',
  ],
  [
    'dist/server/index.d.ts',
    "import \\{ Ctx \\} from '@briven/schema';\\nexport \\{ Ctx \\} from '@briven/schema';",
    '@briven/schema',
  ],
];

async function main() {
  for (const [file, searchPattern, sourcePkg] of REPLACEMENTS) {
    const filePath = resolve(here, '..', file);

    /** @type {string} */
    let content;
    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      console.warn(`[dts-inline] ${file} not found — skipping`);
      continue;
    }

    // Resolve the workspace package's DTS entry via its exports map.
    // Workspace packages aren't in node_modules, so use the known
    // monorepo layout: packages/<pkg-name>/package.json.
    const pkgDir = resolve(here, '..', '..', sourcePkg.split('/').pop());
    const pkgJsonPath = resolve(pkgDir, 'package.json');

    let pkgJson;
    try {
      pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
    } catch {
      console.warn(`[dts-inline] ${pkgJsonPath} not readable — skipping ${file}`);
      continue;
    }
    const typesExport = pkgJson.exports && pkgJson.exports['.'] && pkgJson.exports['.'].types;
    if (!typesExport) {
      console.warn(`[dts-inline] ${sourcePkg} has no exports['.'].types — skipping ${file}`);
      continue;
    }

    const typesPath = resolve(dirname(pkgJsonPath), typesExport);
    /** @type {string} */
    let typesContent;
    try {
      typesContent = await readFile(typesPath, 'utf8');
    } catch {
      console.warn(`[dts-inline] ${typesPath} not readable — skipping ${file}`);
      continue;
    }

    const regex = new RegExp(searchPattern, 'g');
    if (!regex.test(content)) {
      console.warn(`[dts-inline] pattern not found in ${file} — skipping`);
      continue;
    }

    // Reset regex lastIndex after test()
    regex.lastIndex = 0;
    const newContent = content.replace(regex, typesContent.trim());

    await writeFile(filePath, newContent, 'utf8');
    console.log(`[dts-inline] ${file} — inlined ${typesContent.length} chars from ${sourcePkg}`);
  }
}

main().catch((err) => {
  console.error(`[dts-inline] fatal: ${err.message}`);
  process.exit(1);
});
