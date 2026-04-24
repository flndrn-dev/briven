import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../../lib/api';
import { AddMemberForm } from './add-member-form';
import { InvitationRow } from './invitation-row';
import { InviteForm } from './invite-form';
import { MemberActions } from './member-actions';

type Role = 'owner' | 'admin' | 'developer' | 'viewer';

interface Member {
  userId: string;
  name: string | null;
  role: Role;
  createdAt: string;
  email?: string;
}

interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export const dynamic = 'force-dynamic';

export default async function MembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ members }, invitesRes] = await Promise.all([
    apiJson<{ members: Member[] }>(`/v1/projects/${id}/members`),
    apiJson<{ invitations: Invitation[] }>(`/v1/projects/${id}/invitations`).catch(() => ({
      invitations: [] as Invitation[],
    })),
  ]);

  const pendingInvites = invitesRes.invitations.filter((i) => !i.acceptedAt && !i.revokedAt);

  async function addMember(formData: FormData) {
    'use server';
    const { id } = await params;
    const email = String(formData.get('email') ?? '').trim();
    const role = String(formData.get('role') ?? 'developer') as Role;
    const res = await apiFetch(`/v1/projects/${id}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `add member failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/members`);
  }

  async function invite(formData: FormData) {
    'use server';
    const { id } = await params;
    const email = String(formData.get('email') ?? '').trim();
    const role = String(formData.get('role') ?? 'developer') as Role;
    const res = await apiFetch(`/v1/projects/${id}/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        role,
        callbackURL: `https://briven.cloud/dashboard/invitations/accept`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `invite failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/members`);
  }

  async function revokeInvite(invitationId: string) {
    'use server';
    const { id } = await params;
    const res = await apiFetch(`/v1/projects/${id}/invitations/${invitationId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`revoke failed: ${res.status}`);
    revalidatePath(`/dashboard/projects/${id}/members`);
  }

  async function updateRole(userId: string, role: Role) {
    'use server';
    const { id } = await params;
    const res = await apiFetch(`/v1/projects/${id}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) throw new Error(`update failed: ${res.status}`);
    revalidatePath(`/dashboard/projects/${id}/members`);
  }

  async function remove(userId: string) {
    'use server';
    const { id } = await params;
    const res = await apiFetch(`/v1/projects/${id}/members/${userId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`remove failed: ${res.status}`);
    revalidatePath(`/dashboard/projects/${id}/members`);
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">members</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          owners have full control. admins manage members and keys. developers can deploy. viewers
          are read-only.
        </p>
      </header>

      <section>
        <h3 className="font-mono text-xs text-[var(--color-text-muted)]">invite by email</h3>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-subtle)]">
          sends a single-use link. valid for 7 days; revoke any time before accept.
        </p>
        <div className="mt-3">
          <InviteForm action={invite} />
        </div>

        {pendingInvites.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {pendingInvites.map((inv) => (
              <InvitationRow key={inv.id} invitation={inv} onRevoke={revokeInvite} />
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <h3 className="font-mono text-xs text-[var(--color-text-muted)]">
          add existing user directly
        </h3>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-subtle)]">
          skips the invite email — the user must already exist in briven.
        </p>
        <div className="mt-3">
          <AddMemberForm action={addMember} />
        </div>
      </section>

      <section>
        <h3 className="font-mono text-xs text-[var(--color-text-muted)]">current members</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
            >
              <div>
                <p className="font-mono text-sm">{m.name ?? m.userId}</p>
                <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                  {m.userId} · joined {new Date(m.createdAt).toISOString().slice(0, 10)}
                </p>
              </div>
              <MemberActions
                userId={m.userId}
                role={m.role}
                onUpdateRole={updateRole}
                onRemove={remove}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
