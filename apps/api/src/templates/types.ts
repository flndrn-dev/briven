import type { StudioColumnSpec } from '../services/studio.js';

/**
 * A single table in a starter template: its column schema plus optional
 * sample rows seeded right after creation. Rows are inserted via the same
 * studio `insertRow` path the UI uses, so every value is schema-validated.
 *
 * Rows that need to be referenced by a later table's foreign key carry an
 * explicit `id` (a literal uuid) instead of relying on the `gen_random_uuid()`
 * default — that way the child rows can point at a known parent id.
 */
export interface TemplateTable {
  readonly tableName: string;
  readonly columns: readonly StudioColumnSpec[];
  readonly rows?: ReadonlyArray<Record<string, unknown>>;
}

/**
 * A ready-made starter a non-coder picks at signup ("I want to track ___").
 * Briven creates the tables + seeds the sample rows so the user lands on a
 * working database instead of an empty screen.
 */
export interface TemplateDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Emoji hint for the picker UI. */
  readonly icon: string;
  /**
   * Tables in creation order. A table that references another via a foreign
   * key MUST appear after its target so the reference resolves at create time.
   */
  readonly tables: readonly TemplateTable[];
}
