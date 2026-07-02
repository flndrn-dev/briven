import { RocketIcon } from '@/components/ui/rocket';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { StatCard } from '../_components/stat-card';

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
  ).catch(() => ({ deploys: [] as DeployEntry[] }));

  // Honest stats — all derived from the rows actually fetched (last 100).
  const todayUtc = new Date().toISOString().slice(0, 10);
  const deploysToday = deploys.filter((d) => {
    const booted = toValidDate(d.bootedAt);
    return booted !== null && booted.toISOString().slice(0, 10) === todayUtc;
  }).length;
  const services = new Set(deploys.map((d) => d.service)).size;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <RocketIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">deploys</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          one row per api boot, newest first. the build sha comes from{' '}
          <code>BRIVEN_BUILD_SHA</code> (passed by <code>scripts/deploy-kvm4.sh</code>) or — when
          absent — from <code>.git/HEAD</code> inside the image. local boots with sha{' '}
          <code>&quot;dev&quot;</code> are intentionally skipped.
        </p>
      </header>

      {deploys.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="deploys recorded"
            value={deploys.length}
            icon={<RocketIcon size={14} />}
            hint="most recent 100 boots"
          />
          <StatCard
            label="deploys today"
            value={deploysToday}
            tone={deploysToday > 0 ? 'primary' : 'default'}
            icon={<RocketIcon size={14} />}
            hint="utc · within the 100 shown"
          />
          <StatCard
            label="services"
            value={services}
            icon={<RocketIcon size={14} />}
            hint="distinct services in this window"
          />
        </div>
      ) : null}

      <Section
        title="deploy history"
        icon={<RocketIcon size={16} />}
        right={
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            newest first · last 100
          </span>
        }
      >
        {deploys.length === 0 ? (
          <EmptyState
            icon={<RocketIcon size={28} />}
            title="no deploys recorded yet"
            message="the table is populated automatically the next time the api boots with a real build sha."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            <table className="w-full font-mono text-xs">
              <thead className="text-left text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                <tr>
                  <th className="px-6 py-4 font-medium">booted</th>
                  <th className="px-6 py-4 font-medium">service</th>
                  <th className="px-6 py-4 font-medium">sha</th>
                  <th className="px-6 py-4 font-medium">built</th>
                  <th className="px-6 py-4 font-medium">env</th>
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
                      <td className="whitespace-nowrap px-6 py-4 text-[var(--color-text-subtle)]">
                        <div>{formatTs(d.bootedAt)}</div>
                        <div className="mt-0.5 text-[var(--color-text-muted)]">
                          {relativeTime(d.bootedAt)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-[var(--color-text)]">
                          {d.service}
                        </span>
                        {isCurrent ? (
                          <span className="ml-2 inline-flex rounded-full bg-[var(--color-primary-subtle)] px-2 py-0.5 text-[var(--color-primary)]">
                            live
                          </span>
                        ) : null}
                      </td>
                      <td className="px-6 py-4">
                        <code className="text-[var(--color-text)]">{d.buildSha.slice(0, 12)}</code>
                      </td>
                      <td className="px-6 py-4 text-[var(--color-text-muted)]">
                        {d.buildAt ? formatTs(d.buildAt) : '—'}
                      </td>
                      <td className="px-6 py-4">
                        <span className="rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                          {d.env}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
