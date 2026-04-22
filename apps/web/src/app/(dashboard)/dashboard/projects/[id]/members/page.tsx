import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../../lib/api';
import { AddMemberForm } from './add-member-form';
import { MemberActions } from './member-actions';

type Role = 'owner' | 'admin' | 'developer' | 'viewer';

interface Member {
  userId: string;
  name: string | null;
  role: Role;
  createdAt: string;
  // email is returned by the api but intentionally not surfaced; see CLAUDE.md §5.1
  email?: string;
}

export const dynamic = 'force-dynamic';

export default async function MembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { members } = await apiJson<{ members: Member[] }>(`/v1/projects/${id}/members`);

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

      <AddMemberForm action={addMember} />

      <ul className="flex flex-col gap-2">
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
    </div>
  );
}
