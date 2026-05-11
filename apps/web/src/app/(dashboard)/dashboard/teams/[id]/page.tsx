import Link from 'next/link';
import { redirect } from 'next/navigation';

import { apiFetch, apiJson } from '../../../../../lib/api';

interface Org {
  id: string;
  slug: string;
  name: string;
  personal: boolean;
  createdAt: string | Date;
}

interface Project {
  id: string;
  slug: string;
  name: string;
  region: string;
  tier: 'free' | 'pro' | 'team';
  orgName: string | null;
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'team · settings' };

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ orgs }, { projects }] = await Promise.all([
    apiJson<{ orgs: Org[] }>('/v1/me/orgs'),
    apiJson<{ projects: Project[] }>('/v1/projects'),
  ]);
  const org = orgs.find((o) => o.id === id);
  if (!org) {
    // Either it doesn't exist or the user isn't a member — same UX
    // either way: bounce to the teams list.
    redirect('/dashboard/teams');
  }
  // Soft cast — redirect throws but TS doesn't model it.
  const team = org as Org;
  const teamProjects = projects.filter((p) => p.orgName === team.name);

  async function rename(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    if (!name) throw new Error('team name is required');
    const res = await apiFetch(`/v1/orgs/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`rename failed (${res.status}): ${body}`);
    }
    redirect(`/dashboard/teams/${id}`);
  }

  return (
    <section className="flex flex-col gap-8">
      <header>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          <Link href="/dashboard/teams" className="hover:text-[var(--color-text)]">
            ← all teams
          </Link>
        </p>
        <h1 className="mt-2 font-mono text-xl tracking-tight">{team.name}</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          {team.personal ? 'personal org' : 'team org'} · {team.slug}
        </p>
      </header>

      {!team.personal ? (
        <section className="max-w-lg">
          <h2 className="mb-3 font-mono text-sm text-[var(--color-text-muted)]">rename</h2>
          <form action={rename} className="flex flex-col gap-3">
            <input
              name="name"
              type="text"
              required
              maxLength={200}
              defaultValue={team.name}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
            />
            <button
              type="submit"
              className="self-start rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
            >
              rename team
            </button>
          </form>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 font-mono text-sm text-[var(--color-text-muted)]">
          projects in this {team.personal ? 'personal org' : 'team'}
        </h2>
        {teamProjects.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--color-border)] p-6 font-mono text-sm text-[var(--color-text-muted)]">
            no projects yet.{' '}
            <Link href="/dashboard/projects/new" className="underline">
              create one
            </Link>
            {' '}and pick this {team.personal ? 'org' : 'team'} in the dropdown.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {teamProjects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/dashboard/projects/${p.id}`}
                  className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 transition hover:border-[var(--color-border)]"
                >
                  <span className="font-mono text-sm">{p.name}</span>
                  <span className="font-mono text-xs text-[var(--color-text-subtle)]">
                    {p.region} · {p.tier}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-mono text-sm text-[var(--color-text-muted)]">members</h2>
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
          org-level member management is a phase 3 follow-up. for now, share projects with
          collaborators by adding them as <strong>project members</strong> via{' '}
          <em>/dashboard/projects/&lt;id&gt;/members</em> — each project has its own
          owner/admin/developer/viewer role assignment.
        </p>
      </section>
    </section>
  );
}
