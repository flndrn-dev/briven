import type { Config } from 'drizzle-kit';

/**
 * `drizzle-kit generate` only needs the schema — we leave `dbCredentials`
 * absent when no URL is set so developers can regenerate migrations offline.
 * Commands that hit a live database (`migrate`, `push`, `studio`) will fail
 * explicitly at drizzle-kit's level, which is clearer than throwing here.
 *
 * @README-BRIVEN ADR 0001 — migrated from postgresql to mysql dialect.
 */
const url = process.env.BRIVEN_URL;

export default {
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'mysql',
  dbCredentials: url ? { url } : { url: 'mysql://placeholder@localhost/placeholder' },
  strict: true,
  verbose: true,
} satisfies Config;
