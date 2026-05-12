import Link from 'next/link';

import { apiJson } from '../../../../../../../lib/api';

interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultExpr: string | null;
  isPrimaryKey: boolean;
  references?: { table: string; column: string } | null;
}

interface FullSchemaTable {
  name: string;
  columns: ColumnInfo[];
}

interface RelationshipEdge {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

interface FullSchema {
  tables: FullSchemaTable[];
  relationships: RelationshipEdge[];
}

export const metadata = { title: 'schema overview' };
export const dynamic = 'force-dynamic';

export default async function SchemaOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const schema = await apiJson<FullSchema>(`/v1/projects/${id}/studio/schema`);

  // Index inbound FKs so each table card can show "← comments.user_id".
  const inbound = new Map<string, RelationshipEdge[]>();
  for (const e of schema.relationships) {
    const arr = inbound.get(e.toTable) ?? [];
    arr.push(e);
    inbound.set(e.toTable, arr);
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-mono text-lg tracking-tight">schema overview</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            every table, every column, every relationship — in one canvas.{' '}
            {schema.tables.length} table{schema.tables.length === 1 ? '' : 's'} ·{' '}
            {schema.relationships.length} fk edge
            {schema.relationships.length === 1 ? '' : 's'}.
          </p>
        </div>
        <Link
          href={`/dashboard/projects/${id}/studio`}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          ← table list
        </Link>
      </header>

      {schema.tables.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-10 text-center font-mono text-sm text-[var(--color-text-muted)]">
          no tables yet — start in studio.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {schema.tables.map((t) => {
            const incoming = inbound.get(t.name) ?? [];
            return (
              <article
                key={t.name}
                className="flex flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3"
              >
                <header className="flex items-center justify-between">
                  <Link
                    href={`/dashboard/projects/${id}/studio/${encodeURIComponent(t.name)}`}
                    className="font-mono text-sm text-[var(--color-text)] hover:text-[var(--color-primary)]"
                  >
                    {t.name}
                  </Link>
                  <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                    {t.columns.length} col{t.columns.length === 1 ? '' : 's'}
                  </span>
                </header>
                <ul className="flex flex-col gap-0.5 font-mono text-[10px]">
                  {t.columns.map((c) => (
                    <li key={c.name} className="flex items-center gap-1">
                      <span
                        className={
                          c.isPrimaryKey
                            ? 'text-[var(--color-primary)]'
                            : 'text-[var(--color-text)]'
                        }
                      >
                        {c.name}
                      </span>
                      <span className="text-[var(--color-text-subtle)]">{c.dataType}</span>
                      {c.references ? (
                        <Link
                          href={`/dashboard/projects/${id}/studio/${encodeURIComponent(c.references.table)}`}
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                        >
                          → {c.references.table}.{c.references.column}
                        </Link>
                      ) : null}
                      {c.isPrimaryKey ? (
                        <span className="ml-auto text-[var(--color-text-subtle)]">pk</span>
                      ) : !c.nullable ? (
                        <span className="ml-auto text-[var(--color-text-subtle)]">not null</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {incoming.length > 0 ? (
                  <div className="mt-1 border-t border-[var(--color-border-subtle)] pt-2 font-mono text-[10px] text-[var(--color-text-subtle)]">
                    referenced by:{' '}
                    {incoming.map((e, i) => (
                      <span key={i}>
                        {i > 0 ? ', ' : ''}
                        <Link
                          href={`/dashboard/projects/${id}/studio/${encodeURIComponent(e.fromTable)}`}
                          className="hover:text-[var(--color-text)]"
                        >
                          {e.fromTable}.{e.fromColumn}
                        </Link>
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
