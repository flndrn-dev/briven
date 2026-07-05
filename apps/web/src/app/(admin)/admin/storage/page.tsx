import { DatabaseIcon } from '@/components/ui/database';
import { FoldersIcon } from '@/components/ui/folders';
import { LayoutGridIcon } from '@/components/ui/layout-grid';
import { TriangleAlertIcon } from '@/components/ui/triangle-alert';

import { apiJson } from '@/lib/api';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { StatCard } from '../_components/stat-card';
import { EnforcementForm } from './enforcement-form';
import { ProjectLimitForm } from './project-limit-form';
import { RecoverFileForm } from './recover-file-form';
import { TierCapsForm, type Tier, type TierCap } from './tier-caps-form';

interface ProjectStorageUsage {
  id: string;
  name: string;
  tier: Tier;
  tableCount: number;
  rowCount: number;
  maxRows: number;
  maxTables: number;
  hasOverride: boolean;
  enforcement: 'flag' | 'block';
  overRows: boolean;
  overTables: boolean;
  overLimit: boolean;
}

interface ObjectStorageUsage {
  id: string;
  name: string;
  tier: Tier;
  usedBytes: number;
  capBytes: number;
  recoveryDays: number;
  keyCount: number;
  over: boolean;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'admin · storage' };

function publicApiOrigin(): string {
  return process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
}

function num(n: number): string {
  return n > 0 ? n.toLocaleString() : '—';
}

function pct(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

/**
 * Compact usage bar. Fills proportionally to used/max and flips to the
 * error colour once `over` is true, so an operator scanning the table
 * spots a project at/over its cap without reading the numbers.
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

export default async function AdminStoragePage() {
  const apiOrigin = publicApiOrigin();
  const [{ usage }, { caps }, { usage: objectUsage }] = await Promise.all([
    apiJson<{ usage: ProjectStorageUsage[] }>('/v1/admin/storage').catch(() => ({ usage: [] as ProjectStorageUsage[] })),
    apiJson<{ caps: Record<Tier, TierCap> }>('/v1/admin/storage/tier-caps').catch(() => ({ caps: { free: { maxRows: 0, maxTables: 0 }, pro: { maxRows: 0, maxTables: 0 }, team: { maxRows: 0, maxTables: 0 } } as Record<Tier, TierCap> })),
    apiJson<{ usage: ObjectStorageUsage[] }>('/v1/admin/storage/object').catch(() => ({ usage: [] as ObjectStorageUsage[] })),
  ]);

  // Real totals derived from the fetched usage list — nothing invented.
  const overCount = usage.filter((u) => u.overLimit).length;
  const totalRows = usage.reduce((sum, u) => sum + u.rowCount, 0);
  const totalTables = usage.reduce((sum, u) => sum + u.tableCount, 0);

  // Object-storage totals derived from the fetched object usage list.
  const objectOverCount = objectUsage.filter((u) => u.over).length;
  const totalObjectBytes = objectUsage.reduce((sum, u) => sum + u.usedBytes, 0);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <DatabaseIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">storage</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          per-project storage usage and limits. usage is counted in rows + tables — the
          database (DoltGres) can&apos;t report on-disk bytes, so there is no byte figure to
          show.
        </p>
      </header>

      {/* ── the numbers ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="projects tracked"
          value={usage.length}
          icon={<FoldersIcon size={14} />}
          hint="projects with storage accounting"
        />
        <StatCard
          label="total rows"
          value={totalRows}
          icon={<DatabaseIcon size={14} />}
          tone="primary"
          hint="across all projects · live count"
        />
        <StatCard
          label="total tables"
          value={totalTables}
          icon={<LayoutGridIcon size={14} />}
          hint="across all projects · live count"
        />
        <StatCard
          label="over limit"
          value={overCount}
          icon={<TriangleAlertIcon size={14} />}
          tone={overCount > 0 ? 'warning' : 'default'}
          hint="projects at or past their cap"
        />
      </div>

      {/* ── tier caps ────────────────────────────────────────────────── */}
      <Section
        title="tier caps"
        icon={<LayoutGridIcon size={16} />}
        right={
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            mutations require fresh step-up auth
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="max-w-prose font-mono text-xs text-[var(--color-text-muted)]">
            default row + table limits per plan tier. saving applies immediately on the api —
            no redeploy. projects with a per-project override below ignore these.
          </p>
          <TierCapsForm apiOrigin={apiOrigin} caps={caps} />
        </div>
      </Section>

      {/* ── per-project usage ────────────────────────────────────────── */}
      <Section
        title={`project usage · ${usage.length.toLocaleString()}`}
        icon={<DatabaseIcon size={16} />}
        right={
          overCount > 0 ? (
            <span className="font-mono text-[10px] text-[var(--color-error)]">
              {overCount} over limit
            </span>
          ) : undefined
        }
      >
        {usage.length === 0 ? (
          <EmptyState
            icon={<DatabaseIcon size={24} />}
            title="no projects yet"
            message="per-project row and table usage appears here as soon as the first project exists."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            <table className="w-full border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)] text-left text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  <th className="px-4 py-3 font-normal">project</th>
                  <th className="px-4 py-3 font-normal">tier</th>
                  <th className="px-4 py-3 font-normal">rows</th>
                  <th className="px-4 py-3 font-normal">rows usage</th>
                  <th className="px-4 py-3 font-normal">tables</th>
                  <th className="px-4 py-3 font-normal">tables usage</th>
                  <th className="px-4 py-3 font-normal">limit</th>
                  <th className="px-4 py-3 font-normal">enforcement</th>
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
                      {u.hasOverride ? (
                        <span className="ml-2 inline-flex rounded-full bg-[var(--color-primary-subtle)] px-2 py-0.5 text-[10px] text-[var(--color-primary)]">
                          override
                        </span>
                      ) : null}
                      {u.overLimit ? (
                        <span className="ml-2 inline-flex rounded-full bg-[var(--color-error)]/10 px-2 py-0.5 text-[10px] text-[var(--color-error)]">
                          over limit
                        </span>
                      ) : null}
                      <p className="mt-1 font-mono text-[10px] text-[var(--color-text-subtle)]">
                        {u.id}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-[var(--color-text-muted)]">{u.tier}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-[var(--color-text)]">
                      {num(u.rowCount)}{' '}
                      <span className="text-[var(--color-text-subtle)]">
                        / {num(u.maxRows)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <UsageBar used={u.rowCount} max={u.maxRows} over={u.overRows} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-[var(--color-text)]">
                      {num(u.tableCount)}{' '}
                      <span className="text-[var(--color-text-subtle)]">
                        / {num(u.maxTables)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <UsageBar used={u.tableCount} max={u.maxTables} over={u.overTables} />
                    </td>
                    <td className="px-4 py-4">
                      <ProjectLimitForm
                        apiOrigin={apiOrigin}
                        projectId={u.id}
                        projectName={u.name}
                        hasOverride={u.hasOverride}
                        effectiveMaxRows={u.maxRows}
                        effectiveMaxTables={u.maxTables}
                        tierMaxRows={caps[u.tier].maxRows}
                        tierMaxTables={caps[u.tier].maxTables}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <EnforcementForm
                        apiOrigin={apiOrigin}
                        projectId={u.id}
                        projectName={u.name}
                        enforcement={u.enforcement}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── object storage (S3 / file usage) · read-only mirror ──────── */}
      <Section
        title={`object storage · ${objectUsage.length.toLocaleString()}`}
        icon={<DatabaseIcon size={16} />}
        right={
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            {formatBytes(totalObjectBytes)} total
            {objectOverCount > 0 ? (
              <span className="ml-2 text-[var(--color-error)]">· {objectOverCount} over cap</span>
            ) : null}
          </span>
        }
      >
        {objectUsage.length === 0 ? (
          <EmptyState
            icon={<DatabaseIcon size={24} />}
            title="no object storage yet"
            message="per-project file (S3) usage appears here once a project uploads its first object."
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
                  <th className="px-4 py-3 font-normal">recovery</th>
                  <th className="px-4 py-3 font-normal">active keys</th>
                </tr>
              </thead>
              <tbody>
                {objectUsage.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-[var(--color-border-subtle)] align-top transition-colors last:border-0 hover:bg-[var(--color-surface-raised)]"
                  >
                    <td className="px-4 py-4">
                      <span className="text-[var(--color-text)]">{u.name}</span>
                      {u.over ? (
                        <span className="ml-2 inline-flex rounded-full bg-[var(--color-error)]/10 px-2 py-0.5 text-[10px] text-[var(--color-error)]">
                          over limit
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
                    <td className="whitespace-nowrap px-4 py-4 text-[var(--color-text-muted)]">
                      {u.recoveryDays} days
                    </td>
                    <td className="px-4 py-4 text-[var(--color-text)]">{u.keyCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3 border-t border-[var(--color-border-subtle)] pt-6">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
            recover a deleted file (on request)
          </h3>
          <p className="max-w-prose font-mono text-[10px] text-[var(--color-text-muted)]">
            un-delete a single soft-deleted file within its recovery window — the support path when
            a customer emails asking to restore file X. paste the project id and file id from their
            message.
          </p>
          <RecoverFileForm apiOrigin={apiOrigin} />
        </div>
      </Section>
    </div>
  );
}
