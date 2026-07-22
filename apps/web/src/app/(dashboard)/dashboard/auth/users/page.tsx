import { fetchAuthUsers } from '../lib/auth-api';

export const metadata = { title: 'Auth · users' };
export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const result = await fetchAuthUsers(100);

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-sans text-2xl font-medium tracking-[-0.02em] text-[var(--color-text)]">
          {result.ok
            ? `${result.users.length} user${result.users.length === 1 ? '' : 's'}`
            : 'users'}
        </h1>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          people who signed in through Auth
        </p>
      </header>

      {!result.ok ? (
        <p className="font-mono text-sm text-[var(--color-text-muted)]">
          {result.status === 401
            ? 'sign in to load users.'
            : `could not load users.`}
        </p>
      ) : result.users.length === 0 ? (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
          <p className="font-mono text-sm text-[var(--color-text)]">no users yet</p>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            when people sign in to your apps, they appear here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)] rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
          {result.users.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-[var(--color-text)]">
                  {(u.emails ?? [])[0] ||
                    (u.phoneNumbers ?? [])[0] ||
                    u.id}
                </p>
                <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
                  {u.tenantId ? `project island · ${u.tenantId}` : u.id}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
