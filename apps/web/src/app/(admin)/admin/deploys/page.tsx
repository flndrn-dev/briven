import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

interface DeployEntry {
  id: string;
  service: string;
  buildSha: string;
  buildAt: string | null;
  env: string;
  bootedAt: string | Date;
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'admin · deploys' };

function formatTs(t: string | Date): string {
  const d = toValidDate(t);
  return d ? d.toISOString().replace('T', ' ').slice(0, 19) + 'Z' : '—';
}

function relativeTime(t: string | Date): string {
  const d = typeof t === 'string' ? new Date(t) : t;
  const then = d.getTime();
  if (!Number.isFinite(then)) return '';
  const sec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

export default async function DeploysAdminPage() {
  const { deploys } = await apiJson<{ deploys: DeployEntry[] }>(
    '/v1/admin/deploys?limit=100',
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-mono text-lg">deploy history</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          one row per api boot, newest first. the build sha comes from{' '}
          <code>BRIVEN_BUILD_SHA</code> (passed by{' '}
          <code>scripts/deploy-kvm4.sh</code>) or — when absent — from{' '}
          <code>.git/HEAD</code> inside the image. local boots with sha{' '}
          <code>&quot;dev&quot;</code> are intentionally skipped.
        </p>
      </div>

      {deploys.length === 0 ? (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6 font-mono text-sm text-[var(--color-text-muted)]">
          no deploys recorded yet. the table is populated automatically the next
          time the api boots with a real build sha.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full font-mono text-xs">
            <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">booted</th>
                <th className="px-3 py-2 font-medium">service</th>
                <th className="px-3 py-2 font-medium">sha</th>
                <th className="px-3 py-2 font-medium">built</th>
                <th className="px-3 py-2 font-medium">env</th>
              </tr>
            </thead>
            <tbody>
              {deploys.map((d, idx) => {
                const isCurrent = idx === 0;
                return (
                  <tr
                    key={d.id}
                    className="border-t border-[var(--color-border-subtle)] align-top"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--color-text-subtle)]">
                      <div>{formatTs(d.bootedAt)}</div>
                      <div className="text-[var(--color-text-muted)]">
                        {relativeTime(d.bootedAt)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex rounded-md bg-[var(--color-surface)] px-2 py-0.5">
                        {d.service}
                      </span>
                      {isCurrent ? (
                        <span className="ml-2 inline-flex rounded-md bg-[var(--color-primary-subtle)] px-2 py-0.5 text-[var(--color-primary)]">
                          live
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <code className="text-[var(--color-text)]">
                        {d.buildSha.slice(0, 12)}
                      </code>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">
                      {d.buildAt ? formatTs(d.buildAt) : '—'}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">{d.env}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
