import Link from 'next/link';

import { apiJson } from '../../../../lib/api';
import { toValidDate } from '@/lib/utils';

interface Org {
  id: string;
  slug: string;
  name: string;
  personal: boolean;
  createdAt: string | Date;
}

interface SubscriptionSummary {
  tier: 'free' | 'pro' | 'team';
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'teams' };

function formatDate(t: string | Date): string {
  const d = toValidDate(t);
  return d ? d.toISOString().slice(0, 10) : '—';
}

export default async function TeamsPage() {
  const [{ orgs }, subscription] = await Promise.all([
    apiJson<{ orgs: Org[] }>('/v1/me/orgs'),
    apiJson<SubscriptionSummary>('/v1/billing/subscription').catch(() => ({
      tier: 'free' as const,
    })),
  ]);
  const personal = orgs.find((o) => o.personal);
  const teams = orgs.filter((o) => !o.personal);
  const canCreateTeam = subscription.tier !== 'free';

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-xl tracking-tight">teams</h1>
          <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
            an org owns projects, billing, and membership. you always have a personal org;
            create teams to share projects with collaborators.
          </p>
        </div>
        {canCreateTeam ? (
          <Link
            href="/dashboard/teams/new"
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
          >
            new team
          </Link>
        ) : (
          <Link
            href="/dashboard/billing"
            className="rounded-md border border-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-primary)] transition hover:bg-[var(--color-surface)]"
          >
            upgrade to create teams
          </Link>
        )}
      </header>

      {personal ? (
        <section>
          <h2 className="mb-3 font-mono text-sm text-[var(--color-text-muted)]">personal</h2>
          <OrgCard org={personal} />
          <p className="mt-2 font-mono text-[11px] text-[var(--color-text-subtle)]">
            your personal org is auto-created on first sign-in and can&apos;t be deleted. it&apos;s
            where your own solo projects live.
          </p>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 font-mono text-sm text-[var(--color-text-muted)]">teams</h2>
        {teams.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--color-border)] p-6 font-mono text-sm text-[var(--color-text-muted)]">
            {canCreateTeam ? (
              <>
                no teams yet. create one to share projects, billing, and audit logs with
                collaborators.
              </>
            ) : (
              <>
                team workspaces are a paid feature. on the free tier you get one personal org;
                upgrade to pro or team to spin up unlimited shared workspaces.
              </>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {teams.map((o) => (
              <li key={o.id}>
                <OrgCard org={o} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function OrgCard({ org }: { org: Org }) {
  return (
    <Link
      href={`/dashboard/teams/${org.id}`}
      className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-border)]"
    >
      <div className="min-w-0">
        <p className="font-mono text-sm text-[var(--color-text)]">{org.name}</p>
        <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
          {org.slug} · created {formatDate(org.createdAt)}
        </p>
      </div>
      <span className="rounded-md bg-[var(--color-surface-raised)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
        {org.personal ? 'personal' : 'team'}
      </span>
    </Link>
  );
}
