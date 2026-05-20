import { describe, expect, it } from 'bun:test';

import { exportSchemaToDsl } from './schema-export.js';

describe('exportSchemaToDsl', () => {
  it('emits a minimal blank table', () => {
    const dsl = exportSchemaToDsl({
      tables: [
        {
          name: 'notes',
          columns: [
            { name: 'id', sqlType: 'text', nullable: false, primaryKey: true },
            { name: 'body', sqlType: 'text', nullable: false, primaryKey: false },
          ],
        },
      ],
    });
    expect(dsl).toContain("from '@briven/cli/schema'");
    expect(dsl).toContain('notes: table({');
    expect(dsl).toContain('id: text().primaryKey(),');
    expect(dsl).toContain('body: text().notNull(),');
  });

  it('marks unknown postgres types with a TODO comment', () => {
    const dsl = exportSchemaToDsl({
      tables: [
        {
          name: 'odd',
          columns: [
            { name: 'id', sqlType: 'text', nullable: false, primaryKey: true },
            { name: 'data', sqlType: 'tsvector', nullable: true, primaryKey: false },
          ],
        },
      ],
    });
    expect(dsl).toContain("// TODO: unsupported type 'tsvector' — confirm");
  });
});
