import Link from 'next/link';

import { ShieldCheckIcon } from '@/components/ui/shield-check';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { TriageActions } from './triage-actions';

type Resolution = 'no_action' | 'warned' | 'suspended' | 'banned';

interface AbuseReport {
  reportId: string;
  targetUrl: string;
  reason: string;
  severity: string;
  status: 'open' | 'triaged' | 'resolved';
  reporterContact: string | null;
  createdAt: string;
  lastActionAt: string;
  resolution: Resolution | null;
}

const STATUS_FILTERS = [
  { label: 'open', value: 'open' },
  { label: 'triaged', value: 'triaged' },
  { label: 'resolved', value: 'resolved' },
  { label: 'all', value: '' },
] as const;

export const dynamic = 'force-dynamic';

function publicApiOrigin(): string {
  return process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
}

export default async function AbuseReportsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter = status && status !== '' ? `?status=${encodeURIComponent(status)}` : '';
  const { reports } = await apiJson<{ reports: AbuseReport[] }>(
    `/v1/admin/abuse-reports${filter}`,
  ).catch(() => ({ reports: [] as AbuseReport[] }));
  const apiOrigin = publicApiOrigin();

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <ShieldCheckIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">abuse reports</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          reports filed against hosted content. triage what&apos;s new, then resolve with an
          outcome — optionally suspending the offending project in the same step. mutations
          require fresh step-up auth.
        </p>
      </header>

      <Section
        title={`${reports.length} report${reports.length === 1 ? '' : 's'} in view`}
        icon={<ShieldCheckIcon size={16} />}
        right={
          <div className="flex gap-2 font-mono text-xs">
            {STATUS_FILTERS.map((f) => {
              const active = (status ?? 'open') === f.value || (!status && f.value === 'open');
              return (
                <Link
                  key={f.value || 'all'}
                  href={f.value ? `?status=${f.value}` : `?status=`}
                  className={`rounded-full border px-3 py-1 transition-colors ${
                    active
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]'
                      : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {f.label}
                </Link>
              );
            })}
          </div>
        }
      >
        {reports.length === 0 ? (
          <EmptyState
            icon={<ShieldCheckIcon size={28} />}
            title="the queue is clear"
            message="no reports in this view."
          />
        ) : (
          <ul className="flex flex-col gap-6">
            {reports.map((r) => (
              <li
                key={r.reportId}
                className="flex flex-col gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                        r.severity === 'csam' || r.severity === 'malware'
                          ? 'bg-[var(--color-text-error)] text-[var(--color-text-inverse)]'
                          : 'border border-[var(--color-border-subtle)] text-[var(--color-text-muted)]'
                      }`}
                    >
                      {r.severity}
                    </span>
                    <span className="font-mono text-xs text-[var(--color-text-subtle)]">
                      {r.reportId}
                    </span>
                    {r.resolution ? (
                      <span className="font-mono text-xs text-[var(--color-text-muted)]">
                        → {r.resolution}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 truncate font-mono text-sm text-[var(--color-text)]">
                    {r.targetUrl}
                  </p>
                  <p className="mt-1.5 font-mono text-xs text-[var(--color-text-muted)]">
                    {r.reason}
                  </p>
                  <p className="mt-1.5 font-mono text-[11px] text-[var(--color-text-subtle)]">
                    reported{' '}
                    {toValidDate(r.createdAt)?.toISOString().slice(0, 16).replace('T', ' ') ?? '—'}
                    {r.reporterContact ? ` · contact: ${r.reporterContact}` : ' · anonymous'}
                  </p>
                </div>
                <TriageActions
                  reportId={r.reportId}
                  currentStatus={r.status}
                  apiOrigin={apiOrigin}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
