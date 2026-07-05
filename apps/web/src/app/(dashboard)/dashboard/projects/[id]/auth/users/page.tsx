import Link from 'next/link';

import { apiJson } from '../../../../../../../lib/api';

interface RedactedUser {
  id: string;
  emailDomainHint: string;
  nameInitial: string | null;
  providerIds: string[];
  lastSeenAt: string | null;
  createdAt: string;
}

interface UsersResponse {
  items: RedactedUser[];
  nextCursor: string | null;
}

interface AuthStateResponse {
  enabled: boolean;
  config: { providers: Record<string, unknown>; branding: Record<string, unknown> };
}

export const metadata = { title: 'auth · users' };
export const dynamic = 'force-dynamic';

export default async function AuthUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const cursor = asString(sp.cursor);

  // Probe the enabled flag first — if the project hasn't enabled auth,
  // the api would 500 on the users SELECT (table doesn't exist). Cheap
  // round-trip avoids that.
  const state = await apiJson<AuthStateResponse>(`/v1/projects/${id}/auth/config`).catch(
    () => null,
  );

  if (!state || !state.enabled) {
    return (
      <section className="flex flex-col gap-6">
        <header>
          <h2 className="font-mono text-lg tracking-tight">auth · users</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            enable auth on this project first.
          </p>
        </header>
        <Link
          href={`/dashboard/projects/${id}/auth`}
          className="self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          ← back to auth overview
        </Link>
      </section>
    );
  }

  const qs = new URLSearchParams({ limit: '50' });
  if (cursor) qs.set('cursor', cursor);
  const data = await apiJson<UsersResponse>(
    `/v1/projects/${id}/auth/users?${qs.toString()}`,
  );

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-lg tracking-tight">auth · users</h2>
        <p className="mt-1 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          authenticated end-users for this project.
        </p>
      </header>

      {data.items.length === 0 ? (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-xs text-[var(--color-text-muted)]">
          no users yet. the table populates as your customers sign up.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full min-w-max font-mono text-xs">
            <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-normal">id</th>
                <th className="px-3 py-2 font-normal">domain</th>
                <th className="px-3 py-2 font-normal">name</th>
                <th className="px-3 py-2 font-normal">providers</th>
                <th className="px-3 py-2 font-normal">last seen</th>
                <th className="px-3 py-2 font-normal">created</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr
                  key={u.id}
                  className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-raised)]/50"
                >
                  <td className="px-3 py-2 text-[var(--color-text)]">
                    <Link
                      href={`/dashboard/projects/${id}/auth/users/${u.id}`}
                      className="hover:text-[var(--color-primary)]"
                    >
                      <code title={u.id}>{truncateId(u.id)}</code>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text)]">
                    <span className="text-[var(--color-text-muted)]">•••@</span>
                    {u.emailDomainHint}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text)]">
                    {u.nameInitial ? (
                      <span>{u.nameInitial}•••</span>
                    ) : (
                      <span className="text-[var(--color-text-subtle)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {u.providerIds.length === 0 ? (
                      <span className="text-[var(--color-text-subtle)]">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {u.providerIds.map((p) => (
                          <span
                            key={p}
                            className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
                          >
                            {p}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {u.lastSeenAt ? relative(u.lastSeenAt) : '—'}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {relative(u.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-3">
        {cursor ? (
          <Link
            href={`/dashboard/projects/${id}/auth/users`}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >
            ← first page
          </Link>
        ) : null}
        {data.nextCursor ? (
          <Link
            href={`/dashboard/projects/${id}/auth/users?cursor=${encodeURIComponent(data.nextCursor)}`}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >
            next page →
          </Link>
        ) : null}
        {!data.nextCursor && !cursor ? (
          <span className="font-mono text-[11px] text-[var(--color-text-subtle)]">
            showing {data.items.length} user{data.items.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function asString(v: string | string[] | undefined): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

function truncateId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/**
 * Relative timestamp for the dashboard. "2 hours ago", "5 days ago", etc.
 * Falls back to ISO date when older than 30 days.
 */
function relative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const deltaMs = Date.now() - then;
  if (deltaMs < 60_000) return 'just now';
  if (deltaMs < 60 * 60_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  if (deltaMs < 24 * 60 * 60_000) return `${Math.floor(deltaMs / (60 * 60_000))}h ago`;
  if (deltaMs < 30 * 24 * 60 * 60_000) return `${Math.floor(deltaMs / (24 * 60 * 60_000))}d ago`;
  return iso.slice(0, 10);
}
