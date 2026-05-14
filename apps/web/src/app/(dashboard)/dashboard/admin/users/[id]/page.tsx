import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiJson, ApiError } from '../../../../../../lib/api';

interface UserDetail {
  user: {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    isAdmin: boolean;
    suspendedAt: string | null;
    createdAt: string;
    projectCount: number;
  };
  orgs: Array<{ id: string; name: string; slug: string; personal: boolean; role: string }>;
  projects: Array<{
    id: string;
    slug: string;
    name: string;
    tier: string;
    orgId: string;
    createdAt: string;
  }>;
  recentAudit: Array<{
    id: string;
    action: string;
    createdAt: string;
    metadata: Record<string, unknown> | null;
  }>;
}

export const dynamic = 'force-dynamic';

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let detail: UserDetail;
  try {
    detail = await apiJson<UserDetail>(`/v1/admin/users/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const { user, orgs, projects, recentAudit } = detail;
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/dashboard/admin/users"
          className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          ← all users
        </Link>
        <h2 className="font-mono text-lg text-[var(--color-text)]">{user.email}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {user.isAdmin ? <Pill tone="warning" label="platform admin" /> : null}
          {user.suspendedAt ? <Pill tone="error" label="suspended" /> : null}
          {!user.emailVerified ? <Pill tone="muted" label="unverified" /> : null}
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            user id <code>{user.id}</code> · joined {formatDate(user.createdAt)}
          </span>
        </div>
      </header>

      <Section title="orgs">
        {orgs.length === 0 ? (
          <Empty>no org memberships.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {orgs.map((o) => (
              <li
                key={o.id}
                className="flex items-baseline justify-between gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
              >
                <div>
                  <p className="font-mono text-sm text-[var(--color-text)]">{o.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-subtle)]">
                    {o.personal ? 'personal org' : 'team org'} · slug <code>{o.slug}</code> ·{' '}
                    role <code>{o.role}</code>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`projects (${projects.length})`}>
        {projects.length === 0 ? (
          <Empty>no projects in any org this user belongs to.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((p) => {
              const org = orgById.get(p.orgId);
              return (
                <li
                  key={p.id}
                  className="flex items-baseline justify-between gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-[var(--color-text)]">{p.name}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-subtle)]">
                      <code>{p.slug}</code> · {p.tier} tier · in {org?.name ?? p.orgId} ·{' '}
                      created {formatDate(p.createdAt)}
                    </p>
                  </div>
                  <Link
                    href={`/dashboard/projects/${p.id}`}
                    className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    open →
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="recent activity (last 50)">
        {recentAudit.length === 0 ? (
          <Empty>no audit rows where this user is the actor.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {recentAudit.map((row) => (
              <li
                key={row.id}
                className="flex items-baseline justify-between gap-4 px-4 py-2"
              >
                <span className="truncate font-mono text-xs text-[var(--color-text)]">
                  {row.action}
                </span>
                <time
                  className="shrink-0 font-mono text-[10px] text-[var(--color-text-subtle)]"
                  dateTime={row.createdAt}
                >
                  {formatTimestamp(row.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 text-center font-mono text-xs text-[var(--color-text-muted)]">
      {children}
    </p>
  );
}

function Pill({ tone, label }: { tone: 'warning' | 'error' | 'muted'; label: string }) {
  const cls = {
    warning: 'border-[var(--color-warning)] text-[var(--color-warning)]',
    error: 'border-[var(--color-error)] text-[var(--color-error)]',
    muted: 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]',
  }[tone];
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' utc';
}
