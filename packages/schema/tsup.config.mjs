/**
 * DTS-only build for @briven/schema.
 *
 * The source .ts files ARE the runtime — no JS output needed
 * (Bun/Deno/tsx consume them directly within the monorepo, and
 * @briven/cli's tsup inlines them when building the tarball).
 *
 * We only emit .d.ts so that tsup's DTS resolver on dependent
 * packages (specifically @briven/cli) can follow `export * from
 * '@briven/schema'` and inline the types.
 */
export default {
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: { only: true },
  clean: true,
  external: ['zod', '@briven/shared', '@briven/config'],
};
