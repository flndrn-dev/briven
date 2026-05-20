import Link from 'next/link';

import { ApiError, apiJson } from '../../../../../../lib/api';
import { CopySchemaButton } from './copy-schema-button';
import { NewTableForm } from './new-table-form';

interface TableSummary {
  name: string;
  approxRowCount: number;
  bytes: number;
}

interface RelationshipEdge {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export const metadata = { title: 'studio' };
export const dynamic = 'force-dynamic';

export default async function StudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [tablesResult, relResult] = await Promise.all([
    apiJson<{ tables: TableSummary[] }>(`/v1/projects/${id}/studio/tables`).catch((err) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        return { tables: [] as TableSummary[], forbidden: true as const };
      }
      return { tables: [] as TableSummary[], forbidden: false as const };
    }),
    apiJson<{ edges: RelationshipEdge[] }>(`/v1/projects/${id}/studio/relationships`).catch(
      () => ({ edges: [] as RelationshipEdge[] }),
    ),
  ]);
  const tables = tablesResult.tables;
  const forbidden = 'forbidden' in tablesResult && tablesResult.forbidden;
  const edges = relResult.edges;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-mono text-lg tracking-tight">studio</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            build your database from here — create tables, add columns, edit rows. or
            keep using the CLI (<code>briven deploy</code> with a <code>schema.ts</code>);
            both paths write to the same schema.
          </p>
        </div>
        {tables.length > 0 ? (
          <div className="flex items-start gap-2">
            <Link
              href={`/dashboard/projects/${id}/studio/schema`}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              schema overview →
            </Link>
            <Link
              href={`/dashboard/projects/${id}/studio/sql`}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              sql editor →
            </Link>
            <CopySchemaButton projectId={id} />
            <NewTableForm projectId={id} existingTables={tables.map((t) => t.name)} />
          </div>
        ) : null}
      </header>

      {forbidden ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-6">
          <p className="font-mono text-sm text-[var(--color-text)]">
            admin role required.
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            studio surfaces full row contents, so only project admins can open it.
            ask a project admin to bump your role, or open another tab.
          </p>
        </div>
      ) : tables.length === 0 ? (
        <div className="flex flex-col gap-4 rounded-md border border-dashed border-[var(--color-border)] p-6">
          <div>
            <p className="font-mono text-sm text-[var(--color-text)]">
              your database is empty.
            </p>
            <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
              name your first table below to start. you can also deploy a{' '}
              <code>briven/schema.ts</code> from the CLI — both paths land in the same
              postgres schema for this project.
            </p>
          </div>
          <NewTableForm projectId={id} existingTables={tables.map((t) => t.name)} />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
            <table className="w-full min-w-[480px] font-mono text-sm">
              <thead className="bg-[var(--color-surface)]">
                <tr className="text-left text-[var(--color-text-muted)]">
                  <th className="px-4 py-2 font-normal">table</th>
                  <th className="px-4 py-2 font-normal">approx rows</th>
                  <th className="px-4 py-2 font-normal">size</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((t) => (
                  <tr
                    key={t.name}
                    className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface)]"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/dashboard/projects/${id}/studio/${encodeURIComponent(t.name)}`}
                        className="text-[var(--color-text-link)] hover:underline"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-[var(--color-text-muted)]">
                      {t.approxRowCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-[var(--color-text-muted)]">
                      {formatBytes(t.bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {edges.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="font-mono text-sm text-[var(--color-text-muted)]">relationships</h3>
              <ul className="flex flex-col gap-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-xs">
                {edges.map((e, i) => (
                  <li key={i} className="text-[var(--color-text-muted)]">
                    <Link
                      href={`/dashboard/projects/${id}/studio/${encodeURIComponent(e.fromTable)}`}
                      className="text-[var(--color-text)] hover:underline"
                    >
                      {e.fromTable}
                    </Link>
                    .{e.fromColumn}
                    <span className="mx-1 text-[var(--color-primary)]">→</span>
                    <Link
                      href={`/dashboard/projects/${id}/studio/${encodeURIComponent(e.toTable)}`}
                      className="text-[var(--color-text)] hover:underline"
                    >
                      {e.toTable}
                    </Link>
                    .{e.toColumn}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
