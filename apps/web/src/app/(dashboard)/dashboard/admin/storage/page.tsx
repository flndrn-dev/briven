import { apiJson } from '../../../../../lib/api';
import { EnforcementForm } from './enforcement-form';
import { ProjectLimitForm } from './project-limit-form';
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
  const [{ usage }, { caps }] = await Promise.all([
    apiJson<{ usage: ProjectStorageUsage[] }>('/v1/admin/storage'),
    apiJson<{ caps: Record<Tier, TierCap> }>('/v1/admin/storage/tier-caps'),
  ]);

  const overCount = usage.filter((u) => u.overLimit).length;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="font-mono text-lg">storage</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          per-project storage usage and limits. usage is counted in rows + tables — the
          database (DoltGres) can&apos;t report on-disk bytes, so there is no byte figure to
          show.
        </p>
      </div>

      {/* ── Tier caps ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="font-mono text-sm text-[var(--color-text)]">tier caps</h3>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            default row + table limits per plan tier. saving applies immediately on the api —
            no redeploy. projects with a per-project override below ignore these.
          </p>
        </div>
        <TierCapsForm apiOrigin={apiOrigin} caps={caps} />
      </section>

      {/* ── Per-project usage ─────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-mono text-sm text-[var(--color-text)]">project usage</h3>
          <p className="font-mono text-xs text-[var(--color-text-muted)]">
            {usage.length} project{usage.length === 1 ? '' : 's'}
            {overCount > 0 ? (
              <span className="ml-2 text-[var(--color-error)]">· {overCount} over limit</span>
            ) : null}
          </p>
        </div>

        {usage.length === 0 ? (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6 font-mono text-sm text-[var(--color-text-muted)]">
            no projects yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
            <table className="w-full font-mono text-xs">
              <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">project</th>
                  <th className="px-3 py-2 font-medium">tier</th>
                  <th className="px-3 py-2 font-medium">rows</th>
                  <th className="px-3 py-2 font-medium">rows usage</th>
                  <th className="px-3 py-2 font-medium">tables</th>
                  <th className="px-3 py-2 font-medium">tables usage</th>
                  <th className="px-3 py-2 font-medium">limit</th>
                  <th className="px-3 py-2 font-medium">enforcement</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr
                    key={u.id}
                    className="border-t border-[var(--color-border-subtle)] align-top"
                  >
                    <td className="px-3 py-2">
                      <span className="text-[var(--color-text)]">{u.name}</span>
                      {u.hasOverride ? (
                        <span className="ml-2 inline-flex rounded-md bg-[var(--color-primary-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-primary)]">
                          override
                        </span>
                      ) : null}
                      {u.overLimit ? (
                        <span className="ml-2 inline-flex rounded-md bg-[var(--color-error)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-error)]">
                          over limit
                        </span>
                      ) : null}
                      <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-subtle)]">
                        {u.id}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">{u.tier}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--color-text)]">
                      {num(u.rowCount)}{' '}
                      <span className="text-[var(--color-text-subtle)]">
                        / {num(u.maxRows)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <UsageBar used={u.rowCount} max={u.maxRows} over={u.overRows} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--color-text)]">
                      {num(u.tableCount)}{' '}
                      <span className="text-[var(--color-text-subtle)]">
                        / {num(u.maxTables)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <UsageBar used={u.tableCount} max={u.maxTables} over={u.overTables} />
                    </td>
                    <td className="px-3 py-2">
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
                    <td className="px-3 py-2">
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
      </section>
    </div>
  );
}
