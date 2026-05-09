/**
 * Public sub-export: `@briven/cli/server`.
 *
 * Imported by files under `briven/functions/` in consumer repos.
 * Exposes the `Ctx` type (for the first argument of every function)
 * plus `query` / `mutation` / `action` helpers that type-check the
 * signature.
 */
export type { Ctx } from '@briven/schema';
export { query, mutation, action } from './server-helpers.js';
