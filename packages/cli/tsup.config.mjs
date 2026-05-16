/**
 * Build config for @briven/cli.
 *
 * Three entries, one output package: the CLI binary plus two public
 * sub-exports consumers import from (`@briven/cli/schema` and
 * `@briven/cli/server`). briven workspace packages are inlined via
 * `noExternal` so the shipped tarball has no workspace refs.
 *
 * ESM-only. Node 20+ and all four supported package managers
 * (npm, pnpm, yarn, bun) resolve ESM packages without trouble.
 */
export default {
  entry: {
    'cli/index': 'src/index.ts',
    'schema/index': 'src/schema.ts',
    'server/index': 'src/server.ts',
  },
  format: ['esm'],
  dts: { resolve: true },
  clean: true,
  target: 'node20',
  splitting: false,
  sourcemap: true,
  noExternal: ['@briven/schema', '@briven/shared', '@briven/config'],
  external: ['chokidar', 'picocolors', 'tsx', 'zod', 'ulid'],
};
