import Link from 'next/link';

import { apiJson } from '@/lib/api';

export const metadata = { title: 'admin · migration funnel' };
export const dynamic = 'force-dynamic';

interface FunnelRow {
  source: string;
  views: number;
  leads: number;
  conversion: number | null;
}

interface FunnelResponse {
  rows: FunnelRow[];
  totals: FunnelRow;
  sinceDays: number;
}

const SOURCE_LABEL: Record<string, string> = {
  hub: '/migrate (hub)',
  convex: 'convex',
  supabase: 'supabase',
  firebase: 'firebase / firestore',
  mongodb: 'mongodb',
  drizzle: 'drizzle',
  prisma: 'prisma',
  postgres: 'raw postgres',
  hasura: 'hasura',
  nextauth: 'nextauth / auth.js',
  other: 'other / not listed',
  all: 'totals',
};

function formatPercent(c: number | null): string {
  if (c === null) return '—';
  return `${(c * 100).toFixed(1)}%`;
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
}

export default async function MigrationFunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const days = Math.max(1, Math.min(365, Number(params.days) || 30));
  const data = await apiJson<FunnelResponse>(`/v1/admin/marketing-funnel?days=${days}`).catch((): FunnelResponse => ({ rows: [], totals: { source: 'all', views: 0, leads: 0, conversion: null }, sinceDays: days }));

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          <Link
            href="/admin/migrations"
            className="hover:text-[var(--color-text)]"
          >
            ← migration triage
          </Link>
        </p>
        <h2 className="font-mono text-lg tracking-tight">migration funnel</h2>
        <p className="font-mono text-sm text-[var(--color-text-muted)]">
          per-source views (anyone landing on /migrate or /migrate/&lt;source&gt;) and
          leads submitted through the public form on those pages. lead-counts are
          server-side, so a forged claim from the public POST can&apos;t inflate them.
          window: last {days} days.
        </p>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`?days=${d}`}
              className={`rounded-md border px-2 py-1 font-mono text-[10px] ${
                d === days
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]'
              }`}
            >
              {d}d
            </Link>
          ))}
        </div>
      </header>

      <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
        <table className="w-full font-mono text-xs">
          <thead className="bg-[var(--color-surface)] text-[var(--color-text-subtle)]">
            <tr>
              <th className="px-4 py-3 text-left uppercase tracking-wider">source</th>
              <th className="px-4 py-3 text-right uppercase tracking-wider">views</th>
              <th className="px-4 py-3 text-right uppercase tracking-wider">leads</th>
              <th className="px-4 py-3 text-right uppercase tracking-wider">conv.</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-[var(--color-text-muted)]"
                >
                  no events recorded in the last {days} days yet.
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr
                  key={row.source}
                  className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"
                >
                  <td className="px-4 py-2 text-[var(--color-text)]">
                    {SOURCE_LABEL[row.source] ?? row.source}
                  </td>
                  <td className="px-4 py-2 text-right">{formatNum(row.views)}</td>
                  <td className="px-4 py-2 text-right">{formatNum(row.leads)}</td>
                  <td className="px-4 py-2 text-right text-[var(--color-text)]">
                    {formatPercent(row.conversion)}
                  </td>
                </tr>
              ))
            )}
            <tr className="border-t-2 border-[var(--color-border)] bg-[var(--color-surface)] font-medium text-[var(--color-text)]">
              <td className="px-4 py-2">{SOURCE_LABEL.all}</td>
              <td className="px-4 py-2 text-right">{formatNum(data.totals.views)}</td>
              <td className="px-4 py-2 text-right">{formatNum(data.totals.leads)}</td>
              <td className="px-4 py-2 text-right">
                {formatPercent(data.totals.conversion)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
        views are tracked client-side via a pageview beacon to /v1/marketing-events
        (rate-limited 30/min per IP). leads are tracked server-side from POST
        /v1/migration-leads on success only.
      </p>
    </section>
  );
}
