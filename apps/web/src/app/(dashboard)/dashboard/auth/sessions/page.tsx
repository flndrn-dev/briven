import { apiFetch } from '@/lib/api';

export const metadata = { title: 'Auth · sessions' };
export const dynamic = 'force-dynamic';

type SessionRow = {
  handle: string;
  userId: string;
  tenantId: string;
  expiresAt: string;
  createdAt: string;
};

/**
 * Yellow Auth sessions — active briven-engine sessions on Doltgres.
 */
export default async function AuthSessionsPage() {
  let sessions: SessionRow[] = [];
  let err: string | null = null;
  let status = 0;

  try {
    const res = await apiFetch('/v1/auth-core/session/recent?limit=50');
    status = res.status;
    if (res.status === 401) {
      err = 'sign in to briven.tech to see sessions';
    } else if (!res.ok) {
      err = (await res.text().catch(() => '')) || res.statusText;
    } else {
      const body = (await res.json()) as { sessions?: SessionRow[] };
      sessions = body.sessions ?? [];
    }
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  return (
    <section>
      <header className="mb-6">
        <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
          sessions
        </h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          who is signed in right now (app users)
        </p>
      </header>

      {err ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-8 font-mono text-sm text-[var(--color-text-muted)]">
          {status === 401 ? err : err || 'could not load sessions'}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-8 font-mono text-sm text-[var(--color-text-muted)]">
          no active sessions. they appear when app users sign in.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full min-w-[640px] text-left font-mono text-xs">
            <thead className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-normal">user</th>
                <th className="px-3 py-2 font-normal">tenant</th>
                <th className="px-3 py-2 font-normal">created</th>
                <th className="px-3 py-2 font-normal">expires</th>
                <th className="px-3 py-2 font-normal">handle</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.handle}
                  className="border-b border-[var(--color-border-subtle)] last:border-0"
                >
                  <td className="max-w-[10rem] truncate px-3 py-2 text-[var(--color-text)]">
                    {s.userId}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {s.tenantId}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {new Date(s.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {new Date(s.expiresAt).toLocaleString()}
                  </td>
                  <td className="max-w-[8rem] truncate px-3 py-2 text-[var(--color-text-muted)]">
                    {s.handle}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-[var(--color-border-subtle)] px-3 py-2 font-mono text-[10px] text-[var(--color-text-muted)]">
            {sessions.length} active sessions · storage doltgres
          </p>
        </div>
      )}
    </section>
  );
}
