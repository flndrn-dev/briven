import { fetchAuthUsers } from '../lib/auth-api';

export const metadata = { title: 'Briven Auth · users' };
export const dynamic = 'force-dynamic';

/**
 * Users tab — real rows from Doltgres briven_engine (via API).
 */
export default async function UsersPage() {
  const result = await fetchAuthUsers(100);

  return (
    <section className="flex flex-col gap-4">
      <p
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--auth-accent, #e6b800)' }}
      >
        briven-engine · users · doltgres
      </p>
      <h2 className="font-mono text-sm text-[var(--color-text)]">
        People who signed in
      </h2>
      <p className="max-w-xl font-mono text-xs text-[var(--color-text-muted)]">
        Live list from the <code className="text-[var(--color-text)]">be_users</code>{' '}
        table on Doltgres — not the old retired Auth product.
      </p>

      {!result.ok ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          {result.status === 401
            ? 'Sign in to briven.tech to load users.'
            : `Could not load users (${result.status}): ${result.message}`}
        </p>
      ) : result.users.length === 0 ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          No users yet in briven_engine. After local step 1–3 proofs (or real
          sign-ups), they appear here.
        </p>
      ) : (
        <>
          <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
            {result.users.length} user(s) · storage{' '}
            {result.storage ?? 'doltgres'}
          </p>
          <ul className="flex flex-col gap-2">
            {result.users.map((u) => (
              <li
                key={u.id}
                className="rounded-md border p-3 font-mono text-xs"
                style={{
                  borderColor: 'var(--auth-accent-border, var(--color-border))',
                }}
              >
                <div className="text-[var(--color-text)]">{u.id}</div>
                <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                  {(u.emails ?? []).join(', ') || 'no email'}
                  {(u.phoneNumbers?.length ?? 0) > 0
                    ? ` · ${(u.phoneNumbers ?? []).join(', ')}`
                    : ''}
                  {u.tenantId ? ` · tenant ${u.tenantId}` : ''}
                </div>
                <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                  joined {new Date(u.timeJoined).toISOString()}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
