/**
 * Public sub-export: `@briven/cli/server`.
 *
 * Imported by files under `briven/functions/` in consumer repos.
 * Exposes the `Ctx` type (for the first argument of every function)
 * plus `query` / `mutation` / `action` helpers that type-check the
 * signature.
 */
export type { Ctx } from '@briven/schema';
export { query, mutation, action, ulid } from './server-helpers.js';
// `brivenError` is the throwable every function uses for typed failures
// ({ code, message, status }). Re-exported from @briven/shared (bundled into
// this package at build time) so consumer functions need ONE dependency,
// `@briven/cli`, and never reach for the private @briven/shared package.
export { brivenError } from '@briven/shared';
