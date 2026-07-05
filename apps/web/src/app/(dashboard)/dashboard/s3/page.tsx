import Link from 'next/link';

import { DatabaseIcon } from '@/components/ui/database';
import { FoldersIcon } from '@/components/ui/folders';

import { apiJson } from '@/lib/api';

import { EmptyState } from '../../../(admin)/admin/_components/empty-state';
import { Section } from '../../../(admin)/admin/_components/section';
import { StatCard } from '../../../(admin)/admin/_components/stat-card';

/**
 * Cross-project "S3 bucket" home. Lists every project the signed-in user
 * belongs to with its object-storage usage vs tier cap + active key count,
 * and a "manage" link into that project's per-project S3 tab. Read-only
 * aggregation — files are managed inside each project's storage tab.
 */
interface MyStorage {
  id: string;
  name: string;
  tier: 'free' | 'pro' | 'team';
  usedBytes: number;
  capBytes: number;
  keyCount: number;
  over: boolean;
}

// Copied from the admin storage page to match the codebase's style — the
// byte formatter, percent helper, and usage bar are intentionally identical
// so this page reads the same as the operator view.
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function pct(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

/**
 * Compact usage bar. Fills proportionally to used/max and flips to the
 * error colour once `over` is true, so a project at/over its cap stands
 * out without reading the numbers.
 */
function UsageBar({ used, max, over }: { used: number; max: number; over: boolean }) {
  const filled = pct(used, max);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-surface-raised)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${filled}%`,
            backgroundColor: over ? 'var(--color-error)' : 'var(--color-primary)',
          }}
        />
      </div>
      <span
        className={
          over
            ? 'font-mono text-[10px] text-[var(--color-error)]'
            : 'font-mono text-[10px] text-[var(--color-text-subtle)]'
        }
      >
        {filled}%
      </span>
    </div>
  );
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'dashboard · s3 bucket' };

export default async function DashboardS3Page() {
  const { usage } = await apiJson<{ usage: MyStorage[] }>('/v1/me/storage').catch(() => ({
    usage: [] as MyStorage[],
  }));

  // Totals derived only from the fetched list — nothing invented.
  const totalUsedBytes = usage.reduce((sum, u) => sum + u.usedBytes, 0);
  const overCount = usage.filter((u) => u.over).length;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <DatabaseIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">s3 bucket</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          your object storage across all projects — files are managed inside each
          project&apos;s s3 bucket tab.
        </p>
      </header>

      {/* ── the numbers ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="projects"
          value={usage.length}
          icon={<FoldersIcon size={14} />}
          hint="projects you belong to"
        />
        <StatCard
          label="total used"
          value={totalUsedBytes}
          suffix=" B"
          icon={<DatabaseIcon size={14} />}
          tone="primary"
          hint={`${formatBytes(totalUsedBytes)} across all projects`}
        />
        <StatCard
          label="over cap"
          value={overCount}
          icon={<DatabaseIcon size={14} />}
          tone={overCount > 0 ? 'warning' : 'default'}
          hint="projects at or past their storage cap"
        />
      </div>

      {/* ── per-project storage ──────────────────────────────────────── */}
      <Section
        title={`project storage · ${usage.length.toLocaleString()}`}
        icon={<DatabaseIcon size={16} />}
        right={
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            {formatBytes(totalUsedBytes)} total
            {overCount > 0 ? (
              <span className="ml-2 text-[var(--color-error)]">· {overCount} over cap</span>
            ) : null}
          </span>
        }
      >
        {usage.length === 0 ? (
          <EmptyState
            icon={<DatabaseIcon size={24} />}
            title="no projects yet"
            message="create a project to get an s3 bucket — your storage across every project shows up here."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            <table className="w-full border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)] text-left text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  <th className="px-4 py-3 font-normal">project</th>
                  <th className="px-4 py-3 font-normal">tier</th>
                  <th className="px-4 py-3 font-normal">used / cap</th>
                  <th className="px-4 py-3 font-normal">usage</th>
                  <th className="px-4 py-3 font-normal">active keys</th>
                  <th className="px-4 py-3 font-normal" />
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-[var(--color-border-subtle)] align-top transition-colors last:border-0 hover:bg-[var(--color-surface-raised)]"
                  >
                    <td className="px-4 py-4">
                      <span className="text-[var(--color-text)]">{u.name}</span>
                      {u.over ? (
                        <span className="ml-2 inline-flex rounded-full bg-[var(--color-error)]/10 px-2 py-0.5 text-[10px] text-[var(--color-error)]">
                          over cap
                        </span>
                      ) : null}
                      <p className="mt-1 font-mono text-[10px] text-[var(--color-text-subtle)]">
                        {u.id}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-[var(--color-text-muted)]">{u.tier}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-[var(--color-text)]">
                      {formatBytes(u.usedBytes)}{' '}
                      <span className="text-[var(--color-text-subtle)]">
                        / {formatBytes(u.capBytes)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <UsageBar used={u.usedBytes} max={u.capBytes} over={u.over} />
                    </td>
                    <td className="px-4 py-4 text-[var(--color-text)]">{u.keyCount}</td>
                    <td className="px-4 py-4 text-right">
                      <Link
                        href={`/dashboard/projects/${u.id}/storage`}
                        className="inline-flex rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-[11px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border)] hover:text-[var(--color-primary)]"
                      >
                        manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
