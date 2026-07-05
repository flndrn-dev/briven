import { FoldersIcon } from '@/components/ui/folders';
import { LayoutGridIcon } from '@/components/ui/layout-grid';
import { ShieldCheckIcon } from '@/components/ui/shield-check';
import { TriangleAlertIcon } from '@/components/ui/triangle-alert';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

import { ProjectActions } from '../project-actions';

import { EmptyState } from '../../_components/empty-state';
import { Section } from '../../_components/section';

interface ProjectDetail {
  project: {
    id: string;
    slug: string;
    name: string;
    ownerId: string;
    tier: 'free' | 'pro' | 'team';
    suspendedAt: string | null;
    suspendReason: string | null;
    deletedAt: string | null;
    createdAt: string;
  };
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'project · admin' };

/** Honest placeholder — anything null/empty renders "—", never a fake value. */
function dash(v: string | null | undefined): string {
  return v && v.length > 0 ? v : '—';
}

/** A date-ish value as a local date string, or "—" when missing/unparseable. */
function dashDate(v: string | null | undefined): string {
  const d = toValidDate(v);
  return d ? d.toLocaleDateString() : '—';
}

export default async function AdminProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await apiJson<ProjectDetail>(`/v1/admin/projects/${id}`).catch(() => null);

  if (data === null) {
    return (
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-primary)]">
              <FoldersIcon size={20} />
            </span>
            <h1 className="font-mono text-xl tracking-tight">project</h1>
          </div>
          <a
            href="/admin/projects"
            className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)] transition-colors hover:text-[var(--color-text-link)]"
          >
            ← all projects
          </a>
        </header>
        <EmptyState
          icon={<TriangleAlertIcon size={24} />}
          title="project not found"
          message="either the api didn't answer or no project exists with this id — head back and pick one from the list."
        />
      </div>
    );
  }

  const { project } = data;

  return (
    <div className="flex flex-col gap-10">
      {/* ── header ───────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-3">
        <a
          href="/admin/projects"
          className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)] transition-colors hover:text-[var(--color-text-link)]"
        >
          ← all projects
        </a>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[var(--color-primary)]">
            <FoldersIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">{project.name}</h1>
          <span className="rounded-full bg-[var(--color-surface-raised)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
            {project.tier}
          </span>
          {project.suspendedAt ? (
            <span className="rounded-full bg-red-400/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-red-400">
              suspended
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-success)]">
              <ShieldCheckIcon size={12} />
              active
            </span>
          )}
          {project.deletedAt ? (
            <span className="rounded-full bg-red-400/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-red-400">
              deleted
            </span>
          ) : null}
        </div>
        <p className="font-mono text-sm text-[var(--color-text-muted)]">
          project detail — overview and plan-tier control.
        </p>
        <p className="font-mono text-xs text-[var(--color-text-subtle)]">{project.id}</p>
        <div className="pt-1">
          <ProjectActions
            project={{ id: project.id, tier: project.tier, suspendedAt: project.suspendedAt }}
            apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
          />
        </div>
      </header>

      {/* ── overview ─────────────────────────────────────────────────── */}
      <Section title="overview" icon={<LayoutGridIcon size={16} />}>
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 font-mono text-sm sm:grid-cols-2">
            <Field label="name" value={dash(project.name)} />
            <Field label="slug" value={dash(project.slug)} />
            <Field label="id" value={dash(project.id)} />
            <Field label="owner (org)" value={dash(project.ownerId)} />
            <Field label="plan tier" value={dash(project.tier)} />
            <Field
              label="status"
              value={project.suspendedAt ? 'suspended' : project.deletedAt ? 'deleted' : 'active'}
            />
            <Field label="suspend reason" value={dash(project.suspendReason)} />
            <Field label="created" value={dashDate(project.createdAt)} />
          </dl>
        </div>
      </Section>
    </div>
  );
}

/** One overview definition-list field: uppercase mono label + value. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {label}
      </dt>
      <dd className="break-all text-[var(--color-text)]">{value}</dd>
    </div>
  );
}
