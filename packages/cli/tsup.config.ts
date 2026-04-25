import { defineConfig } from 'tsup';

/**
 * Build config for @briven/cli.
 *
 * Three entries, one output package: the CLI binary plus two public
 * sub-exports consumers import from (`@briven/cli/schema` and
 * `@briven/cli/server`). The three briven workspace packages
 * (`@briven/schema`, `@briven/shared`, `@briven/config`) are inlined
 * via `noExternal` so the shipped tarball has no workspace refs.
 *
 * ESM-only. Briven's API and runtime are already ESM, and Node 20+ +
 * all four supported package managers (npm, pnpm, yarn, bun) resolve
 * ESM packages without trouble.
 */
export default defineConfig({
  entry: {
    'cli/index': 'src/index.ts',
    'schema/index': 'src/schema.ts',
    'server/index': 'src/server.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node20',
  splitting: false,
  sourcemap: true,
  noExternal: ['@briven/schema', '@briven/shared', '@briven/config'],
  external: ['chokidar', 'picocolors', 'tsx', 'zod', 'ulid'],
});
