import Link from 'next/link';
import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../lib/api';
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

export default async function AbuseReportsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter = status && status !== '' ? `?status=${encodeURIComponent(status)}` : '';
  const { reports } = await apiJson<{ reports: AbuseReport[] }>(
    `/v1/admin/abuse-reports${filter}`,
  );

  async function triage(reportId: string): Promise<void> {
    'use server';
    const res = await apiFetch(`/v1/admin/abuse-reports/${reportId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'triage' }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `triage failed: ${res.status}`);
    }
    revalidatePath('/dashboard/admin/abuse-reports');
  }

  async function resolve(
    reportId: string,
    resolution: Resolution,
    projectId: string | undefined,
  ): Promise<void> {
    'use server';
    const res = await apiFetch(`/v1/admin/abuse-reports/${reportId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'resolve', resolution, projectId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `resolve failed: ${res.status}`);
    }
    revalidatePath('/dashboard/admin/abuse-reports');
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          {reports.length} report{reports.length === 1 ? '' : 's'}
        </p>
        <div className="flex gap-1 font-mono text-xs">
          {STATUS_FILTERS.map((f) => {
            const active = (status ?? 'open') === f.value || (!status && f.value === 'open');
            return (
              <Link
                key={f.value || 'all'}
                href={f.value ? `?status=${f.value}` : `?status=`}
                className={`rounded-md px-3 py-1 ${
                  active
                    ? 'bg-[var(--color-surface)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
      </div>

      {reports.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-10 text-center">
          <p className="font-mono text-sm text-[var(--color-text-muted)]">
            no reports in this view.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)]">
          {reports.map((r) => (
            <li key={r.reportId} className="flex items-start justify-between gap-4 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                      r.severity === 'csam' || r.severity === 'malware'
                        ? 'bg-[var(--color-text-error)] text-[var(--color-text-inverse)]'
                        : 'border border-[var(--color-border)] text-[var(--color-text-muted)]'
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
                <p className="mt-1 truncate font-mono text-sm">{r.targetUrl}</p>
                <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
                  {r.reason}
                </p>
                <p className="mt-1 font-mono text-xs text-[var(--color-text-subtle)]">
                  reported {new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                  {r.reporterContact ? ` · contact: ${r.reporterContact}` : ' · anonymous'}
                </p>
              </div>
              <TriageActions
                reportId={r.reportId}
                currentStatus={r.status}
                onTriage={triage}
                onResolve={resolve}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
