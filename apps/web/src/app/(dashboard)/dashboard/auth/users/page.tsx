import { fetchAuthUsers } from '../lib/auth-api';

export const metadata = { title: 'Auth · users' };
export const dynamic = 'force-dynamic';

/**
 * Yellow Auth users list — briven-engine users on Doltgres.
 * Requires platform session (briven.tech login).
 */
export default async function AuthUsersPage() {
  const result = await fetchAuthUsers(100);

  return (
    <section>
      <header className="mb-6">
        <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
          users
        </h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          app end-users stored in briven-engine (Doltgres)
        </p>
      </header>

      {!result.ok ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-8 font-mono text-sm text-[var(--color-text-muted)]">
          {result.status === 401
            ? 'sign in to briven.tech to see users'
            : result.message || 'could not load users'}
        </div>
      ) : result.users.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-8 font-mono text-sm text-[var(--color-text-muted)]">
          no app users yet. when apps sign people up, they show here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full min-w-[640px] text-left font-mono text-xs">
            <thead className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-normal">email / phone</th>
                <th className="px-3 py-2 font-normal">user id</th>
                <th className="px-3 py-2 font-normal">tenant</th>
                <th className="px-3 py-2 font-normal">joined</th>
              </tr>
            </thead>
            <tbody>
              {result.users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-[var(--color-border-subtle)] last:border-0"
                >
                  <td className="px-3 py-2 text-[var(--color-text)]">
                    {u.emails[0] ?? u.phoneNumbers[0] ?? '—'}
                  </td>
                  <td className="max-w-[12rem] truncate px-3 py-2 text-[var(--color-text-muted)]">
                    {u.id}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {u.tenantId ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {u.timeJoined
                      ? new Date(u.timeJoined).toLocaleString()
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-[var(--color-border-subtle)] px-3 py-2 font-mono text-[10px] text-[var(--color-text-muted)]">
            {result.users.length} users · storage {result.storage ?? 'doltgres'}
          </p>
        </div>
      )}
    </section>
  );
}
