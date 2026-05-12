import { redirect } from 'next/navigation';

import { apiFetch, apiJson } from '../../../../../lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'new team' };

interface SubscriptionSummary {
  tier: 'free' | 'pro' | 'team';
}

async function createTeam(formData: FormData) {
  'use server';
  const name = String(formData.get('name') ?? '').trim();
  const slug = String(formData.get('slug') ?? '').trim() || undefined;
  if (!name) {
    throw new Error('team name is required');
  }
  const res = await apiFetch('/v1/orgs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, slug }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 402) {
      redirect('/dashboard/billing');
    }
    throw new Error(`team create failed (${res.status}): ${body}`);
  }
  redirect('/dashboard/teams');
}

export default async function NewTeamPage() {
  const subscription = await apiJson<SubscriptionSummary>('/v1/billing/subscription').catch(() => ({
    tier: 'free' as const,
  }));
  if (subscription.tier === 'free') {
    return (
      <section className="max-w-lg">
        <header className="mb-8">
          <h1 className="font-mono text-xl tracking-tight">teams are a paid feature</h1>
          <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
            on the free tier you get one personal org. upgrade to pro or team to spin up
            unlimited shared workspaces with invited collaborators.
          </p>
        </header>
        <a
          href="/dashboard/billing"
          className="inline-block rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
        >
          see upgrade options
        </a>
      </section>
    );
  }

  return (
    <section className="max-w-lg">
      <header className="mb-8">
        <h1 className="font-mono text-xl tracking-tight">new team</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          a team org is a separate workspace from your personal org. projects, billing, and
          membership are scoped to it. you can be in many teams; you can also rename a team
          later from its settings.
        </p>
      </header>

      <form action={createTeam} className="flex flex-col gap-5">
        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">team name</span>
          <input
            name="name"
            type="text"
            required
            maxLength={200}
            placeholder="acme inc"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            slug{' '}
            <span className="text-[var(--color-text-subtle)]">(optional — generated if blank)</span>
          </span>
          <input
            name="slug"
            type="text"
            pattern="[a-z0-9](?:[a-z0-9\-]{0,38}[a-z0-9])?"
            maxLength={40}
            placeholder="acme"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          />
        </label>

        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
          >
            create team
          </button>
        </div>
      </form>
    </section>
  );
}
