import Link from 'next/link';

import { apiJson } from '../../../../../../lib/api';
import { NewTableForm } from './new-table-form';

interface TableSummary {
  name: string;
  approxRowCount: number;
  bytes: number;
}

export const metadata = { title: 'studio' };
export const dynamic = 'force-dynamic';

export default async function StudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tables } = await apiJson<{ tables: TableSummary[] }>(
    `/v1/projects/${id}/studio/tables`,
  );

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
        {tables.length > 0 ? <NewTableForm projectId={id} existingTables={tables.map((t) => t.name)} /> : null}
      </header>

      {tables.length === 0 ? (
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
        <div className="overflow-hidden rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full font-mono text-sm">
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
                  <td className="px-4 py-2 text-[var(--color-text-muted)]">{formatBytes(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
