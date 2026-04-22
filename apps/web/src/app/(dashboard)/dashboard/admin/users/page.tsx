import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../lib/api';
import { UserActions } from './user-actions';

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  isAdmin: boolean;
  suspendedAt: string | null;
  createdAt: string;
  projectCount: number;
}

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const { users } = await apiJson<{ users: AdminUser[] }>('/v1/admin/users');

  async function act(action: string, userId: string) {
    'use server';
    const res = await apiFetch(`/v1/admin/users/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `${action} failed: ${res.status}`);
    }
    revalidatePath('/dashboard/admin/users');
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        {users.length} user{users.length === 1 ? '' : 's'} total
      </p>
      <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)]">
        {users.map((u) => (
          <li key={u.id} className="flex items-start justify-between py-3">
            <div>
              <p className="font-mono text-sm">
                {u.email}
                {u.isAdmin ? (
                  <span className="ml-2 rounded bg-[var(--color-primary-subtle)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-primary)]">
                    admin
                  </span>
                ) : null}
                {u.suspendedAt ? (
                  <span className="ml-2 rounded bg-red-400/20 px-1.5 py-0.5 font-mono text-xs text-red-400">
                    suspended
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                {u.id} · {u.projectCount} project{u.projectCount === 1 ? '' : 's'} ·{' '}
                {u.emailVerified ? 'verified' : 'unverified'} · joined{' '}
                {new Date(u.createdAt).toISOString().slice(0, 10)}
              </p>
            </div>
            <UserActions user={u} act={act} />
          </li>
        ))}
      </ul>
    </div>
  );
}
