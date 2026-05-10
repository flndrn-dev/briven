import Link from 'next/link';

import { apiJson } from '../../../../../../lib/api';

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
      <header>
        <h2 className="font-mono text-lg tracking-tight">studio</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          read-only data browser. row counts are approximate (
          <code>pg_class.reltuples</code>, refreshed by autovacuum). inline edit lands in a
          follow-up.
        </p>
      </header>

      {tables.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-10 text-center">
          <p className="font-mono text-sm text-[var(--color-text-muted)]">
            no tables yet — deploy a <code>briven/schema.ts</code> with at least one table to
            populate this view.
          </p>
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
