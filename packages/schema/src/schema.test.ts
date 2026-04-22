import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  diff,
  generateSql,
  schema,
  table,
  text,
  timestamp,
  type SchemaDef,
} from './index.js';

test('schema rejects reserved _briven_ prefix', () => {
  assert.throws(() =>
    schema({
      _briven_meta: table({ id: text().primaryKey() }),
    }),
  );
});

test('table requires exactly one primary key', () => {
  assert.throws(() => table({ body: text() }));
  assert.throws(() =>
    table({
      a: text().primaryKey(),
      b: text().primaryKey(),
    }),
  );
});

test('generateSql emits CREATE TABLE IF NOT EXISTS', () => {
  const s = schema({
    notes: table({
      id: text().primaryKey(),
      body: text().notNull(),
      createdAt: timestamp().default('now()').notNull(),
    }),
  });
  const sql = generateSql(s);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "notes"/);
  assert.match(sql, /"id" text PRIMARY KEY/);
  assert.match(sql, /"body" text NOT NULL/);
  assert.match(sql, /"createdAt" timestamptz NOT NULL DEFAULT now\(\)/);
});

test('diff detects added tables and columns', () => {
  const prev: SchemaDef | null = null;
  const next = schema({
    notes: table({
      id: text().primaryKey(),
      body: text().notNull(),
    }),
  });
  const firstPass = diff(prev, next);
  assert.equal(firstPass.changes.length, 1);
  assert.equal(firstPass.changes[0]?.kind, 'create_table');
  assert.equal(firstPass.destructive, false);

  const withTitle = schema({
    notes: table({
      id: text().primaryKey(),
      body: text().notNull(),
      title: text(),
    }),
  });
  const secondPass = diff(next, withTitle);
  assert.equal(secondPass.changes.length, 1);
  assert.equal(secondPass.changes[0]?.kind, 'add_column');
  assert.equal(secondPass.destructive, false);

  const withoutBody = schema({
    notes: table({
      id: text().primaryKey(),
      title: text(),
    }),
  });
  const thirdPass = diff(withTitle, withoutBody);
  assert.equal(
    thirdPass.changes.some((c) => c.kind === 'drop_column' && c.column === 'body'),
    true,
  );
  assert.equal(thirdPass.destructive, true);
});

test('table foreign key reference renders in SQL', () => {
  const s = schema({
    users: table({
      id: text().primaryKey(),
    }),
    posts: table({
      id: text().primaryKey(),
      userId: text().notNull().references('users', 'id', { onDelete: 'cascade' }),
    }),
  });
  const sql = generateSql(s);
  assert.match(
    sql,
    /FOREIGN KEY \("userId"\) REFERENCES "users" \("id"\) ON DELETE CASCADE/,
  );
});
