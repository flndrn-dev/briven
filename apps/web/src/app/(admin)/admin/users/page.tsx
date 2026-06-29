import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';
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

function publicApiOrigin(): string {
  return process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
}

export default async function AdminUsersPage() {
  const { users } = await apiJson<{ users: AdminUser[] }>('/v1/admin/users');
  const apiOrigin = publicApiOrigin();

  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        {users.length} user{users.length === 1 ? '' : 's'} total · mutations require fresh
        step-up auth
      </p>
      <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)]">
        {users.map((u) => (
          <li key={u.id} className="flex items-start justify-between py-3">
            <div>
              <p className="font-mono text-sm">
                <a
                  href={`/admin/users/${u.id}`}
                  className="hover:text-[var(--color-text-link)] hover:underline"
                >
                  {u.email}
                </a>
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
                {toValidDate(u.createdAt)?.toISOString().slice(0, 10) ?? '—'}
              </p>
            </div>
            <UserActions user={u} apiOrigin={apiOrigin} />
          </li>
        ))}
      </ul>
    </div>
  );
}
