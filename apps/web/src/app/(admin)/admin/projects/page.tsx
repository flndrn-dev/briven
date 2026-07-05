import Link from 'next/link';

import { FoldersIcon } from '@/components/ui/folders';
import { LayoutGridIcon } from '@/components/ui/layout-grid';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { StatCard } from '../_components/stat-card';

import { SetMineToProButton } from './project-actions';

interface AdminProject {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  tier: string;
  createdAt: string;
}

export const metadata = { title: 'projects · admin' };
export const dynamic = 'force-dynamic';

export default async function AdminProjectsPage() {
  const { projects } = await apiJson<{ projects: AdminProject[] }>('/v1/admin/projects').catch(
    () => ({ projects: [] as AdminProject[] }),
  );

  // Real per-tier counts derived from the fetched list — nothing invented.
  const tierCounts = new Map<string, number>();
  for (const p of projects) {
    tierCounts.set(p.tier, (tierCounts.get(p.tier) ?? 0) + 1);
  }
  // Stable, sensible order: known tiers first, anything unexpected after.
  const tierOrder = ['free', 'pro', 'team'];
  const tiers = [...tierCounts.keys()].sort(
    (a, b) =>
      (tierOrder.includes(a) ? tierOrder.indexOf(a) : tierOrder.length) -
        (tierOrder.includes(b) ? tierOrder.indexOf(b) : tierOrder.length) || a.localeCompare(b),
  );

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-primary)]">
              <FoldersIcon size={20} />
            </span>
            <h1 className="font-mono text-xl tracking-tight">projects</h1>
          </div>
          <SetMineToProButton apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''} />
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          every project on the platform, with its plan tier and owner. counts come straight from
          the live list — no estimates.
        </p>
      </header>

      {/* ── the numbers ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="total projects"
          value={projects.length}
          icon={<FoldersIcon size={14} />}
          tone="primary"
          hint="non-deleted totals"
        />
        {tiers.map((tier) => (
          <StatCard
            key={tier}
            label={`${tier} tier`}
            value={tierCounts.get(tier) ?? 0}
            icon={<LayoutGridIcon size={14} />}
            hint={`projects on the ${tier} plan`}
          />
        ))}
      </div>

      {/* ── the list ─────────────────────────────────────────────────── */}
      <Section
        title={`all projects · ${projects.length.toLocaleString()}`}
        icon={<FoldersIcon size={16} />}
      >
        {projects.length === 0 ? (
          <EmptyState
            icon={<FoldersIcon size={24} />}
            title="no projects to show"
            message="either no projects exist yet, or the api didn't answer — refresh to retry."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {projects.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-[var(--color-surface-raised)]"
              >
                <div className="flex flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-2 font-mono text-sm">
                    <Link
                      href={`/admin/projects/${p.id}`}
                      className="hover:text-[var(--color-primary)]"
                    >
                      {p.name}
                    </Link>
                    <span className="rounded-full bg-[var(--color-surface-raised)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                      {p.tier}
                    </span>
                  </p>
                  <p className="font-mono text-xs text-[var(--color-text-subtle)]">
                    {p.id} · {p.slug} · owner {p.ownerId} · created{' '}
                    {toValidDate(p.createdAt)?.toISOString().slice(0, 10) ?? '—'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
