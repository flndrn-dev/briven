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
  orgId: string;
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
  const teamProjects = projects.filter((p) => p.orgId === team.id);

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

  async function deleteTeam() {
    'use server';
    const res = await apiFetch(`/v1/orgs/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? `delete failed: ${res.status}`);
    }
    redirect('/dashboard/teams');
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

      {!team.personal ? <TeamInvites teamId={id} /> : null}

      {!team.personal ? (
        <section className="max-w-lg border-t border-[var(--color-border-subtle)] pt-6">
          <h2 className="mb-2 font-mono text-sm text-red-400">danger zone</h2>
          <p className="mb-3 font-mono text-xs text-[var(--color-text-muted)]">
            deleting a team is soft — members lose access and billing rolls back to each
            user&apos;s personal tier. you can&apos;t delete a team that still owns projects;
            delete or move them first.
          </p>
          <form action={deleteTeam}>
            <button
              type="submit"
              className="rounded-md border border-red-500/40 px-3 py-1.5 font-mono text-xs text-red-400 transition hover:bg-red-500/10"
            >
              delete this team
            </button>
          </form>
        </section>
      ) : null}
    </section>
  );
}

async function TeamInvites({ teamId }: { teamId: string }) {
  const [{ invitations }, { members }] = await Promise.all([
    apiJson<{
      invitations: Array<{
        id: string;
        email: string;
        role: 'owner' | 'admin' | 'developer' | 'viewer';
        expiresAt: string;
        acceptedAt: string | null;
        revokedAt: string | null;
      }>;
    }>(`/v1/orgs/${teamId}/invitations`),
    apiJson<{
      members: Array<{
        userId: string;
        email: string;
        name: string | null;
        role: 'owner' | 'admin' | 'developer' | 'viewer';
        joinedAt: string;
      }>;
    }>(`/v1/orgs/${teamId}/members`),
  ]);

  const pending = invitations.filter((i) => !i.acceptedAt && !i.revokedAt);

  async function removeMember(userId: string) {
    'use server';
    const res = await apiFetch(`/v1/orgs/${teamId}/members/${userId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? `remove failed: ${res.status}`);
    }
    redirect(`/dashboard/teams/${teamId}`);
  }

  async function changeRole(userId: string, formData: FormData) {
    'use server';
    const role = String(formData.get('role') ?? '').trim();
    if (!role) throw new Error('role is required');
    const res = await apiFetch(`/v1/orgs/${teamId}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? `role change failed: ${res.status}`);
    }
    redirect(`/dashboard/teams/${teamId}`);
  }

  async function invite(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    const role = String(formData.get('role') ?? 'developer');
    if (!email) throw new Error('email is required');
    const res = await apiFetch(`/v1/orgs/${teamId}/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        role,
        callbackURL: `https://briven.tech/dashboard/org-invitations/accept`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`invite failed (${res.status}): ${body}`);
    }
    redirect(`/dashboard/teams/${teamId}`);
  }

  async function revoke(invId: string) {
    'use server';
    const res = await apiFetch(`/v1/orgs/${teamId}/invitations/${invId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`revoke failed: ${res.status}`);
    redirect(`/dashboard/teams/${teamId}`);
  }

  return (
    <section>
      <h2 className="mb-3 font-mono text-sm text-[var(--color-text-muted)]">members</h2>

      <ul className="mb-4 flex flex-col gap-2">
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3"
          >
            <div className="min-w-0">
              <p className="font-mono text-xs text-[var(--color-text)]">
                {m.name ?? m.email}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-subtle)]">
                {m.role} · joined {new Date(m.joinedAt).toISOString().slice(0, 10)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <form action={changeRole.bind(null, m.userId)} className="flex items-center gap-1">
                <select
                  name="role"
                  defaultValue={m.role}
                  aria-label={`role for ${m.email}`}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[10px] outline-none focus:border-[var(--color-primary)]"
                >
                  <option value="owner">owner</option>
                  <option value="admin">admin</option>
                  <option value="developer">developer</option>
                  <option value="viewer">viewer</option>
                </select>
                <button
                  type="submit"
                  className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  save
                </button>
              </form>
              {m.role !== 'owner' ? (
                <form action={removeMember.bind(null, m.userId)}>
                  <button
                    type="submit"
                    className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-error)]"
                  >
                    remove
                  </button>
                </form>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <form action={invite} className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">email</span>
          <input
            name="email"
            type="email"
            required
            placeholder="teammate@example.com"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">role</span>
          <select
            name="role"
            defaultValue="developer"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          >
            <option value="admin">admin</option>
            <option value="developer">developer</option>
            <option value="viewer">viewer</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
        >
          send invite
        </button>
      </form>

      {pending.length === 0 ? (
        <p className="font-mono text-xs text-[var(--color-text-subtle)]">
          no pending invites. the invitee gets an email with a one-time accept link; the link
          expires in 7 days.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3"
            >
              <div className="min-w-0">
                <p className="font-mono text-xs text-[var(--color-text)]">{inv.email}</p>
                <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-subtle)]">
                  {inv.role} · expires {new Date(inv.expiresAt).toISOString().slice(0, 10)}
                </p>
              </div>
              <form action={revoke.bind(null, inv.id)}>
                <button
                  type="submit"
                  className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-error)]"
                >
                  revoke
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
