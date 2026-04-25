/**
 * Public sub-export: `@briven/cli/schema`.
 *
 * This module is what consumer code imports in `briven/schema.ts`
 * files. Everything in `@briven/schema` is surfaced here; tsup's
 * `noExternal` config inlines `@briven/schema` into the bundled
 * output so no workspace ref leaks.
 */
export * from '@briven/schema';
