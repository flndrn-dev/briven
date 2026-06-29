import Link from 'next/link';

import { apiJson } from '../../../lib/api';
import { requireUser } from '../../../lib/session';
import { toValidDate } from '@/lib/utils';

interface Project {
  id: string;
  slug: string;
  name: string;
  region: string;
  tier: 'free' | 'pro' | 'team';
  createdAt: string;
  orgName: string | null;
  orgPersonal: boolean | null;
}

interface PendingInvitation {
  id: string;
  projectName: string;
}

interface PendingOrgInvitation {
  id: string;
  orgId: string;
  orgName: string;
}

interface ActivityRow {
  id: string;
  action: string;
  actorId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface ProjectActivity {
  project: Project;
  rows: ActivityRow[];
}

interface MigrationCard {
  id: string;
  source: string;
  sourceUrl: string | null;
  sourceNotes: string;
  urgency: string;
  status: string;
  contactEmail: string;
  createdAt: string;
  updatedAt: string;
}

export const dynamic = 'force-dynamic';

const TIER_LABEL: Record<Project['tier'], string> = {
  free: 'free',
  pro: 'pro',
  team: 'team',
};

export default async function DashboardHome() {
  const user = await requireUser();

  const [projectsResult, invitesResult, orgInvitesResult, migrationsResult] =
    await Promise.all([
      apiJson<{ projects: Project[] }>('/v1/projects').catch(() => ({
        projects: [] as Project[],
      })),
      apiJson<{ invitations: PendingInvitation[] }>('/v1/me/invitations').catch(() => ({
        invitations: [] as PendingInvitation[],
      })),
      apiJson<{ invitations: PendingOrgInvitation[] }>('/v1/me/org-invitations').catch(
        () => ({
          invitations: [] as PendingOrgInvitation[],
        }),
      ),
      apiJson<{ requests: MigrationCard[] }>(
        '/v1/migration-requests',
      ).catch(() => ({ requests: [] as MigrationCard[] })),
    ]);

  const projects = projectsResult.projects;
  const invitations = invitesResult.invitations;
  const orgInvitations = orgInvitesResult.invitations;
  const openMigrations = migrationsResult.requests.filter(
    (r) => r.status !== 'completed' && r.status !== 'cancelled',
  );

  // Cross-project activity rollup: fan-out to the three most recently
  // created projects only. Bounded N+1 keeps the dashboard root cheap.
  const recentProjects = projects.slice(0, 3);
  const activityFanout: ProjectActivity[] = await Promise.all(
    recentProjects.map(async (project) => {
      const result = await apiJson<{ activity: ActivityRow[] }>(
        `/v1/projects/${project.id}/activity`,
      ).catch(() => ({ activity: [] as ActivityRow[] }));
      return { project, rows: result.activity.slice(0, 10) };
    }),
  );

  const mergedActivity = activityFanout
    .flatMap((pa) =>
      pa.rows.map((row) => ({
        ...row,
        projectId: pa.project.id,
        projectName: pa.project.name,
      })),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);

  const firstName = (user.name ?? '').split(' ')[0] ?? null;
  const hour = new Date().getHours();
  const greeting =
    hour < 5 ? 'still up' : hour < 12 ? 'good morning' : hour < 18 ? 'afternoon' : 'evening';

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          {greeting}
          {firstName ? `, ${firstName.toLowerCase()}` : ''}.
        </p>
        <h1 className="font-sans text-2xl font-medium tracking-[-0.02em] text-[var(--color-text)]">
          {projects.length === 0
            ? "let's set up your first project"
            : `${projects.length} project${projects.length === 1 ? '' : 's'} on briven`}
        </h1>
      </header>

      {invitations.length > 0 ? (
        <Link
          href="/dashboard/invitations"
          className="flex items-center justify-between rounded-md border border-[var(--color-primary)] bg-[var(--color-surface)] px-4 py-3 transition hover:bg-[var(--color-surface-raised)]"
        >
          <div>
            <p className="font-mono text-sm text-[var(--color-text)]">
              {invitations.length === 1
                ? `you have a pending invitation to ${invitations[0]?.projectName ?? 'a project'}.`
                : `you have ${invitations.length} pending project invitations.`}
            </p>
            <p className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]">
              click to review and accept.
            </p>
          </div>
          <span className="font-mono text-sm text-[var(--color-primary)]">→</span>
        </Link>
      ) : null}

      {orgInvitations.length > 0 ? (
        <Link
          href="/dashboard/teams"
          className="flex items-center justify-between rounded-md border border-[var(--color-primary)] bg-[var(--color-surface)] px-4 py-3 transition hover:bg-[var(--color-surface-raised)]"
        >
          <div>
            <p className="font-mono text-sm text-[var(--color-text)]">
              {orgInvitations.length === 1
                ? `you have a pending invitation to join ${orgInvitations[0]?.orgName ?? 'a team'}.`
                : `you have ${orgInvitations.length} pending team invitations.`}
            </p>
            <p className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]">
              open the link in the email to accept.
            </p>
          </div>
          <span className="font-mono text-sm text-[var(--color-primary)]">→</span>
        </Link>
      ) : null}

      {projects.length === 0 && invitations.length === 0 && orgInvitations.length === 0 ? (
        <OnboardingFlow />
      ) : null}

      {openMigrations.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
            active migrations · {openMigrations.length}
          </h2>
          {openMigrations.map((m) => (
            <Link
              key={m.id}
              href={`/dashboard/migrations/${m.id}`}
              className="flex items-center justify-between rounded-md border border-[var(--color-primary)] bg-[var(--color-surface)] px-4 py-3 transition hover:bg-[var(--color-surface-raised)]"
            >
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  {m.source}
                </span>
                <span className="rounded-full border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-primary)]">
                  {m.status.replace(/_/g, ' ')}
                </span>
                <p className="font-mono text-sm text-[var(--color-text)]">
                  {m.urgency.replace(/_/g, ' ')} · submitted{' '}
                  {toValidDate(m.createdAt)?.toISOString().slice(0, 10) ?? '—'}
                </p>
              </div>
              <span className="font-mono text-sm text-[var(--color-primary)]">see progress →</span>
            </Link>
          ))}
          <Link
            href="/dashboard/migrations"
            className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] self-start ml-1"
          >
            all migrations →
          </Link>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="flex flex-col gap-4">
          <header className="flex items-center justify-between">
            <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
              your projects
            </h2>
            <Link
              href="/dashboard/projects"
              className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              show all →
            </Link>
          </header>

          {projects.length === 0 ? (
            <EmptyProjects />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {projects.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/dashboard/projects/${p.id}`}
                    className="flex flex-col gap-1.5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-border-strong)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-sans text-sm text-[var(--color-text)]">{p.name}</span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                        {TIER_LABEL[p.tier]}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-[var(--color-text-muted)]">
                      {p.orgName ?? 'personal'} · {p.region}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <Link
            href="/dashboard/projects/new"
            className="self-start font-mono text-xs text-[var(--color-text-link)] hover:underline"
          >
            + new project
          </Link>
        </section>

        <aside className="flex flex-col gap-4">
          <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
            quick actions
          </h2>
          <div className="flex flex-col gap-2">
            <QuickLink href="/dashboard/projects/new" label="new project" />
            <QuickLink href="https://docs.briven.tech/quickstart" label="quickstart" external />
            <QuickLink href="https://docs.briven.tech/cli" label="cli reference" external />
            <QuickLink href="/dashboard/settings" label="account settings" />
            <QuickLink href="/dashboard/billing" label="billing" />
            <QuickLink href="/status" label="platform status" />
          </div>
        </aside>
      </div>

      <section className="flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
            recent activity
          </h2>
          {recentProjects.length > 0 ? (
            <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              across your {recentProjects.length} most recent project
              {recentProjects.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </header>

        {mergedActivity.length === 0 ? (
          <p className="font-mono text-xs text-[var(--color-text-muted)]">
            no recent activity. deploys, schema changes, and team invites will show up here.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {mergedActivity.map((row) => (
              <li
                key={`${row.projectId}-${row.id}`}
                className="flex items-baseline justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-[var(--color-text)]">
                    {row.action}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                    in{' '}
                    <Link
                      href={`/dashboard/projects/${row.projectId}`}
                      className="text-[var(--color-text-link)] hover:underline"
                    >
                      {row.projectName}
                    </Link>
                  </p>
                </div>
                <time
                  className="shrink-0 font-mono text-[10px] text-[var(--color-text-subtle)]"
                  dateTime={row.createdAt}
                >
                  {formatRelative(row.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function EmptyProjects() {
  return (
    <div className="flex flex-col gap-4 rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <p className="font-sans text-sm text-[var(--color-text)]">no projects yet.</p>
      <ol className="flex flex-col gap-2 font-mono text-xs text-[var(--color-text-muted)]">
        <li>1. create a project — picks a region, generates a deploy key.</li>
        <li>
          2. <code>npx briven init</code> wires up <code>briven/schema.ts</code> and a function
          folder.
        </li>
        <li>
          3. <code>npx briven deploy</code> ships it. studio + logs open up the moment the first
          deploy lands.
        </li>
      </ol>
      <Link
        href="/dashboard/projects/new"
        className="inline-flex h-9 w-fit items-center justify-center rounded-md bg-[var(--color-primary)] px-4 font-sans text-sm text-[var(--color-text-inverse)] transition-colors hover:bg-[var(--color-primary-hover)]"
      >
        create your first project
      </Link>
    </div>
  );
}

function QuickLink({
  href,
  label,
  external,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
    >
      <span>{label}</span>
      <span aria-hidden className="text-[var(--color-text-subtle)]">
        {external ? '↗' : '→'}
      </span>
    </Link>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.round(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

/**
 * First-run onboarding for users with zero projects, zero invitations,
 * and zero pending org invites. Three-step path: spin up a project →
 * open studio → ship a function. Each card is interactive on a single
 * step (the current one); the others are passive previews so the
 * shape of the journey is visible.
 *
 * The "current step" inference is intentionally simple — projects === 0
 * means step 1. Once a project exists this whole block disappears, so
 * we don't need to track step 2/3 cross-render. The studio + CLI links
 * are passive learning anchors here, made interactive after the project
 * lands and the existing dashboard layout takes over.
 */
function OnboardingFlow() {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          first 60 seconds on briven
        </h2>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          three steps to a live reactive backend. you can also import an existing project
          from convex, supabase, firebase, etc. via{' '}
          <Link
            href="/dashboard/projects/new"
            className="text-[var(--color-text-link)] hover:underline"
          >
            new project
          </Link>
          .
        </p>
      </header>
      <ol className="flex flex-col gap-3 sm:grid sm:grid-cols-3 sm:gap-3">
        <OnboardingStep
          n={1}
          title="create a project"
          body="one click. ready in under 10 seconds. you get an empty postgres schema + function runtime + dashboard."
          cta={{ label: 'create project', href: '/dashboard/projects/new' }}
          tone="active"
        />
        <OnboardingStep
          n={2}
          title="open studio"
          body="point-and-click table editor + SQL runner. add your first table, drop in a few rows, see realtime updates land in the schema view."
          cta={{ label: 'after step 1', href: '/dashboard/projects/new' }}
          tone="next"
        />
        <OnboardingStep
          n={3}
          title="deploy a function"
          body="briven init from the CLI scaffolds a project locally. briven deploy ships it. your useQuery() hook in the dashboard goes live."
          cta={{ label: 'cli docs', href: 'https://docs.briven.tech/cli', external: true }}
          tone="next"
        />
      </ol>
    </section>
  );
}

interface OnboardingStepProps {
  n: number;
  title: string;
  body: string;
  cta: { label: string; href: string; external?: boolean };
  tone: 'active' | 'next';
}

function OnboardingStep({ n, title, body, cta, tone }: OnboardingStepProps) {
  const borderClass =
    tone === 'active'
      ? 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)]'
      : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)]';
  const numberClass =
    tone === 'active'
      ? 'bg-[var(--color-primary)] text-[var(--color-text-inverse)]'
      : 'border border-[var(--color-border)] text-[var(--color-text-muted)]';
  return (
    <li
      className={`flex flex-col gap-3 rounded-md border p-4 ${borderClass}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs ${numberClass}`}
        >
          {n}
        </span>
        <p className="font-mono text-sm text-[var(--color-text)]">{title}</p>
      </div>
      <p className="font-mono text-xs text-[var(--color-text-muted)]">{body}</p>
      {tone === 'active' ? (
        cta.external ? (
          <a
            href={cta.href}
            className="mt-auto inline-flex w-fit items-center justify-center rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)]"
          >
            {cta.label} ↗
          </a>
        ) : (
          <Link
            href={cta.href}
            className="mt-auto inline-flex w-fit items-center justify-center rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)]"
          >
            {cta.label}
          </Link>
        )
      ) : (
        <p className="mt-auto font-mono text-[10px] text-[var(--color-text-subtle)]">
          {cta.label}
        </p>
      )}
    </li>
  );
}
