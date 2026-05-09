import { z } from 'zod';

import { isIdentifier } from './table.js';

const RESERVED_PREFIX = '_briven_';

const SAFE_SQL_TYPE_RE =
  /^(text|integer|bigint|boolean|timestamptz|jsonb|uuid|varchar\(\d+\)|vector\(\d+\))$/;

const SAFE_DEFAULT_RE = new RegExp(
  '^(' +
    'null' +
    '|true|false' +
    "|'[^']*'" +
    '|-?\\d+(\\.\\d+)?' +
    '|[a-zA-Z_][a-zA-Z0-9_]{0,62}\\(\\)' +
    '|current_(?:timestamp|date|time|user)' +
    ')$',
  'i',
);

const identifier = z
  .string()
  .min(1)
  .max(63)
  .refine((s) => isIdentifier(s), { message: 'invalid identifier' });

const userTableName = identifier.refine((s) => !s.startsWith(RESERVED_PREFIX), {
  message: `name must not start with reserved prefix '${RESERVED_PREFIX}'`,
});

const safeSqlType = z
  .string()
  .max(64)
  .refine((s) => SAFE_SQL_TYPE_RE.test(s), {
    message:
      'sqlType must be one of text|integer|bigint|boolean|timestamptz|jsonb|uuid|varchar(N)|vector(N)',
  });

const safeDefault = z
  .string()
  .max(256)
  .refine((s) => SAFE_DEFAULT_RE.test(s), {
    message: 'default must be a literal, identifier()-call, or recognised SQL constant',
  });

const onDelete = z.enum(['cascade', 'set null', 'restrict']);

const columnDef = z
  .object({
    sqlType: safeSqlType,
    nullable: z.boolean(),
    primaryKey: z.boolean(),
    unique: z.boolean(),
    default: safeDefault.optional(),
    references: z
      .object({
        table: identifier,
        column: identifier,
        onDelete: onDelete.optional(),
      })
      .optional(),
  })
  .strict();

const indexDef = z
  .object({
    columns: z.array(identifier).min(1),
    unique: z.boolean(),
  })
  .strict();

const accessRules = z
  .object({
    read: z.string().max(2048).optional(),
    write: z.string().max(2048).optional(),
  })
  .strict();

const tableDef = z
  .object({
    columns: z.record(identifier, columnDef),
    indexes: z.array(indexDef),
    access: accessRules.optional(),
  })
  .strict();

export const schemaSnapshotSchema = z
  .object({
    version: z.literal(1),
    tables: z.record(userTableName, tableDef),
  })
  .strict();

export type SchemaSnapshotWire = z.infer<typeof schemaSnapshotSchema>;

export function validateSchemaSnapshot(input: unknown): SchemaSnapshotWire {
  return schemaSnapshotSchema.parse(input);
}
