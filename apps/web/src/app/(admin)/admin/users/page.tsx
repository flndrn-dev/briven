import { ShieldCheckIcon } from '@/components/ui/shield-check';
import { TriangleAlertIcon } from '@/components/ui/triangle-alert';
import { UsersIcon } from '@/components/ui/users';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { StatCard } from '../_components/stat-card';
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

export const metadata = { title: 'users · admin' };
export const dynamic = 'force-dynamic';

function publicApiOrigin(): string {
  return process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
}

export default async function AdminUsersPage() {
  const { users } = await apiJson<{ users: AdminUser[] }>('/v1/admin/users').catch(() => ({
    users: [] as AdminUser[],
  }));
  const apiOrigin = publicApiOrigin();

  // Real counts derived from the fetched list — nothing invented.
  const adminCount = users.filter((u) => u.isAdmin).length;
  const suspendedCount = users.filter((u) => u.suspendedAt !== null).length;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <UsersIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">users</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          every account on the platform — suspend, force sign-out, and admin grants live here.
          mutations require fresh step-up auth.
        </p>
      </header>

      {/* ── the numbers ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <StatCard
          label="total users"
          value={users.length}
          icon={<UsersIcon size={14} />}
          hint="non-deleted accounts"
        />
        <StatCard
          label="admins"
          value={adminCount}
          icon={<ShieldCheckIcon size={14} />}
          tone="primary"
          hint="accounts with admin access"
        />
        <StatCard
          label="suspended"
          value={suspendedCount}
          icon={<TriangleAlertIcon size={14} />}
          tone={suspendedCount > 0 ? 'warning' : 'default'}
          hint="currently suspended accounts"
        />
      </div>

      {/* ── the list ─────────────────────────────────────────────────── */}
      <Section
        title={`all users · ${users.length.toLocaleString()}`}
        icon={<UsersIcon size={16} />}
        right={
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            mutations require fresh step-up auth
          </span>
        }
      >
        {users.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={24} />}
            title="no users to show"
            message="either nobody has signed up yet, or the api didn't answer — refresh to retry."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-start justify-between gap-4 px-6 py-4 transition-colors hover:bg-[var(--color-surface-raised)]"
              >
                <div className="flex flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-2 font-mono text-sm">
                    <a
                      href={`/admin/users/${u.id}`}
                      className="hover:text-[var(--color-text-link)] hover:underline"
                    >
                      {u.email}
                    </a>
                    {u.isAdmin ? (
                      <span className="rounded-full bg-[var(--color-primary-subtle)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]">
                        admin
                      </span>
                    ) : null}
                    {u.suspendedAt ? (
                      <span className="rounded-full bg-red-400/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-red-400">
                        suspended
                      </span>
                    ) : null}
                  </p>
                  <p className="font-mono text-xs text-[var(--color-text-subtle)]">
                    {u.id} · {u.projectCount} project{u.projectCount === 1 ? '' : 's'} ·{' '}
                    {u.emailVerified ? 'verified' : 'unverified'} · joined{' '}
                    {toValidDate(u.createdAt)?.toISOString().slice(0, 10) ?? '—'}
                  </p>
                </div>
                <UserActions user={u} apiOrigin={apiOrigin} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
