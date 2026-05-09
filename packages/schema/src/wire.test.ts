import assert from 'node:assert/strict';
import { test } from 'node:test';

import { schemaSnapshotSchema, validateSchemaSnapshot } from './index.js';

const okColumn = {
  sqlType: 'text',
  nullable: false,
  primaryKey: true,
  unique: false,
};

test('accepts a legitimate snapshot', () => {
  const ok = validateSchemaSnapshot({
    version: 1,
    tables: {
      notes: {
        columns: {
          id: okColumn,
          body: { sqlType: 'text', nullable: false, primaryKey: false, unique: false },
          createdAt: {
            sqlType: 'timestamptz',
            nullable: false,
            primaryKey: false,
            unique: false,
            default: 'now()',
          },
        },
        indexes: [],
      },
      posts: {
        columns: {
          id: okColumn,
          userId: {
            sqlType: 'text',
            nullable: false,
            primaryKey: false,
            unique: false,
            references: { table: 'notes', column: 'id', onDelete: 'cascade' },
          },
        },
        indexes: [{ columns: ['userId'], unique: false }],
      },
    },
  });
  assert.equal(ok.version, 1);
  assert.equal(Object.keys(ok.tables).length, 2);
});

test('rejects table name with quote-injection', () => {
  assert.throws(() =>
    validateSchemaSnapshot({
      version: 1,
      tables: {
        'x" (id text); DROP SCHEMA "proj_other" CASCADE; CREATE TABLE "y': {
          columns: { id: okColumn },
          indexes: [],
        },
      },
    }),
  );
});

test('rejects table name with reserved _briven_ prefix', () => {
  assert.throws(() =>
    validateSchemaSnapshot({
      version: 1,
      tables: {
        _briven_meta: { columns: { id: okColumn }, indexes: [] },
      },
    }),
  );
});

test('rejects column name with quote-injection', () => {
  assert.throws(() =>
    validateSchemaSnapshot({
      version: 1,
      tables: {
        notes: {
          columns: { 'id" text); DROP TABLE "users': okColumn },
          indexes: [],
        },
      },
    }),
  );
});

test('rejects sqlType outside allowlist', () => {
  assert.throws(() =>
    validateSchemaSnapshot({
      version: 1,
      tables: {
        notes: {
          columns: {
            id: {
              sqlType: 'text PRIMARY KEY); DROP SCHEMA other CASCADE; --',
              nullable: false,
              primaryKey: true,
              unique: false,
            },
          },
          indexes: [],
        },
      },
    }),
  );
});

test('accepts sqlType with parametric forms (varchar, vector)', () => {
  const ok = validateSchemaSnapshot({
    version: 1,
    tables: {
      docs: {
        columns: {
          id: okColumn,
          title: { sqlType: 'varchar(255)', nullable: false, primaryKey: false, unique: false },
          embedding: { sqlType: 'vector(1536)', nullable: true, primaryKey: false, unique: false },
        },
        indexes: [],
      },
    },
  });
  assert.equal(ok.tables.docs?.columns.title?.sqlType, 'varchar(255)');
});

test('rejects default that breaks out of literal context', () => {
  assert.throws(() =>
    validateSchemaSnapshot({
      version: 1,
      tables: {
        notes: {
          columns: {
            id: okColumn,
            body: {
              sqlType: 'text',
              nullable: false,
              primaryKey: false,
              unique: false,
              default: "''); DROP TABLE users; --",
            },
          },
          indexes: [],
        },
      },
    }),
  );
});

test('accepts safe default forms', () => {
  for (const def of [
    'now()',
    'gen_random_uuid()',
    'true',
    'false',
    'null',
    '0',
    '-1.5',
    "'hello'",
    'current_timestamp',
  ]) {
    validateSchemaSnapshot({
      version: 1,
      tables: {
        t: {
          columns: {
            id: okColumn,
            v: {
              sqlType: 'text',
              nullable: true,
              primaryKey: false,
              unique: false,
              default: def,
            },
          },
          indexes: [],
        },
      },
    });
  }
});

test('rejects FK references with invalid identifier', () => {
  assert.throws(() =>
    validateSchemaSnapshot({
      version: 1,
      tables: {
        posts: {
          columns: {
            id: okColumn,
            userId: {
              sqlType: 'text',
              nullable: false,
              primaryKey: false,
              unique: false,
              references: { table: 'users"; DROP TABLE x; --', column: 'id' },
            },
          },
          indexes: [],
        },
      },
    }),
  );
});

test('rejects onDelete outside enum', () => {
  assert.throws(() =>
    validateSchemaSnapshot({
      version: 1,
      tables: {
        posts: {
          columns: {
            id: okColumn,
            userId: {
              sqlType: 'text',
              nullable: false,
              primaryKey: false,
              unique: false,
              references: {
                table: 'users',
                column: 'id',
                onDelete: 'CASCADE; DROP TABLE x; --' as 'cascade',
              },
            },
          },
          indexes: [],
        },
      },
    }),
  );
});

test('rejects index columns with invalid identifier', () => {
  assert.throws(() =>
    validateSchemaSnapshot({
      version: 1,
      tables: {
        notes: {
          columns: { id: okColumn },
          indexes: [{ columns: ['id"); DROP TABLE x; --'], unique: false }],
        },
      },
    }),
  );
});

test('rejects version other than 1', () => {
  assert.throws(() =>
    validateSchemaSnapshot({
      version: 2 as 1,
      tables: {},
    }),
  );
});

test('schemaSnapshotSchema is exported as a Zod schema', () => {
  assert.equal(typeof schemaSnapshotSchema.parse, 'function');
});
