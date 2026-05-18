import { describe, expect, test } from 'bun:test';

import { table, text, varchar } from '@briven/schema';

import { renderChange, renderNotifyTrigger, singlePkColumn } from './schema-apply.js';

describe('schema-apply — Phase 1 §1.4 verify (auto-generated triggers)', () => {
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

  test('renderNotifyTrigger emits CREATE FUNCTION + DROP + CREATE TRIGGER (3 statements)', () => {
    const stmts = renderNotifyTrigger('users', usersTable);
    expect(stmts.length).toBe(3);
    expect(stmts[0]).toContain('CREATE OR REPLACE FUNCTION');
    expect(stmts[1]).toMatch(/^DROP TRIGGER IF EXISTS/);
    expect(stmts[2]).toContain('CREATE TRIGGER');
    expect(stmts[2]).toContain('AFTER INSERT OR UPDATE OR DELETE');
  });

  test('single-PK table payload carries op + id (spec §1.4 shape)', () => {
    const [fnStmt] = renderNotifyTrigger('users', usersTable);
    expect(fnStmt).toContain(`json_build_object('op', TG_OP, 'id', rec."id")`);
    // Channel name is dynamic via current_schema() so it stays project-scoped.
    expect(fnStmt).toContain(`'briven_' || current_schema() || '_users'`);
    // DELETE returns OLD, INSERT/UPDATE returns NEW — required by AFTER triggers.
    expect(fnStmt).toContain('IF TG_OP = \'DELETE\' THEN rec := OLD; ELSE rec := NEW; END IF;');
  });

  test('composite-PK table falls back to op-only payload', () => {
    const [fnStmt] = renderNotifyTrigger('memberships', compositePkTable);
    expect(fnStmt).toContain(`json_build_object('op', TG_OP)`);
    expect(fnStmt).not.toContain(`'id', rec.`);
  });

  test('trigger names follow _briven_notify_<table> convention', () => {
    const stmts = renderNotifyTrigger('posts', usersTable);
    expect(stmts[0]).toContain('_briven_notify_posts_fn');
    expect(stmts[1]).toContain('_briven_notify_posts');
    expect(stmts[2]).toContain('_briven_notify_posts');
  });

  test('drop_table cleans trigger + trigger function + table (no orphaned fns)', () => {
    const stmts = renderChange({ kind: 'drop_table', table: 'users' });
    expect(stmts.length).toBe(3);
    // Order matters: trigger → function → table. Function depends on trigger
    // being gone; without explicit drop the function would orphan in the schema.
    expect(stmts[0]).toMatch(/^DROP TRIGGER IF EXISTS _briven_notify_users/);
    expect(stmts[1]).toMatch(/^DROP FUNCTION IF EXISTS _briven_notify_users_fn\(\) CASCADE/);
    expect(stmts[2]).toMatch(/^DROP TABLE IF EXISTS "users" CASCADE/);
  });

  test('create_table emits CREATE TABLE first, then trigger statements', () => {
    const stmts = renderChange({ kind: 'create_table', table: 'users', def: usersTable });
    expect(stmts.length).toBeGreaterThanOrEqual(4); // CREATE TABLE + 3 trigger stmts
    expect(stmts[0]).toMatch(/^CREATE TABLE/);
    expect(stmts.slice(1).join('\n')).toContain('CREATE OR REPLACE FUNCTION');
    expect(stmts.slice(1).join('\n')).toContain('CREATE TRIGGER');
  });
});
