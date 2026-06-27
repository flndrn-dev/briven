import { describe, expect, test } from 'bun:test';

import { table, text, varchar } from '@briven/schema';

import { renderChange, singlePkColumn } from './schema-apply.js';

describe('schema-apply', () => {
  const usersTable = table({
    columns: {
      id: varchar(26).primaryKey(),
      email: varchar(255).notNull(),
    },
  });

  const compositePkTable = table({
    columns: {
      tenant_id: varchar(26).primaryKey(),
      user_id: varchar(26).primaryKey(),
      role: text().notNull(),
    },
  });

  test('singlePkColumn returns the PK name when exactly one column is PK', () => {
    expect(singlePkColumn(usersTable)).toBe('id');
  });

  test('singlePkColumn returns null for composite PK', () => {
    expect(singlePkColumn(compositePkTable)).toBeNull();
  });

  test('create_table emits ONLY the CREATE TABLE (no NOTIFY trigger — sprint S1.7)', () => {
    const stmts = renderChange({ kind: 'create_table', table: 'users', def: usersTable });
    expect(stmts.length).toBe(1);
    expect(stmts[0]).toMatch(/^CREATE TABLE/);
    // Realtime uses DOLT_HASHOF polling, not LISTEN/NOTIFY — no trigger emitted.
    expect(stmts.join('\n')).not.toContain('CREATE TRIGGER');
    expect(stmts.join('\n')).not.toContain('pg_notify');
  });

  test('drop_table still cleans up any pre-existing trigger + function + table', () => {
    const stmts = renderChange({ kind: 'drop_table', table: 'users' });
    expect(stmts.length).toBe(3);
    // Idempotent cleanup of triggers left by projects deployed before S1.7.
    // Order matters: trigger → function → table.
    expect(stmts[0]).toMatch(/^DROP TRIGGER IF EXISTS _briven_notify_users/);
    expect(stmts[1]).toMatch(/^DROP FUNCTION IF EXISTS _briven_notify_users_fn\(\) CASCADE/);
    expect(stmts[2]).toMatch(/^DROP TABLE IF EXISTS "users" CASCADE/);
  });
});
