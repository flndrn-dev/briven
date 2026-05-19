import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiJson } from '../../../../../../../../lib/api';

interface UserDetailResponse {
  user: {
    id: string;
    emailDomainHint: string;
    nameInitial: string | null;
    createdAt: string;
    sessions: Array<{
      id: string;
      createdAt: string;
      expiresAt: string;
      ipHashHint: string | null;
      userAgent: string | null;
    }>;
    accounts: Array<{
      id: string;
      providerId: string;
      providerAccountId: string;
      createdAt: string;
    }>;
    audit: Array<{
      id: string;
      action: string;
      occurredAt: string;
      metadata: Record<string, unknown>;
    }>;
  };
}

export const metadata = { title: 'auth · user' };
export const dynamic = 'force-dynamic';

export default async function AuthUserDetailPage({
  params,
}: {
  params: Promise<{ id: string; userId: string }>;
}) {
  const { id, userId } = await params;

  const detail = await apiJson<UserDetailResponse>(
    `/v1/projects/${id}/auth/users/${userId}`,
  ).catch(() => null);

  if (!detail) notFound();

  const { user } = detail;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-mono text-lg tracking-tight">auth · user</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            <code title={user.id}>{user.id}</code> ·{' '}
            <span className="text-[var(--color-text-muted)]">•••@</span>
            {user.emailDomainHint} ·{' '}
            {user.nameInitial ? (
              <span>name initial: {user.nameInitial}•••</span>
            ) : (
              <span>no name</span>
            )}
          </p>
          <p className="mt-1 font-mono text-[11px] text-[var(--color-text-subtle)]">
            joined {user.createdAt.slice(0, 10)} (utc)
          </p>
        </div>
        <Link
          href={`/dashboard/projects/${id}/auth/users`}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          ← back
        </Link>
      </header>

      <Panel
        title="active sessions"
        emptyHint="no active sessions"
        empty={user.sessions.length === 0}
      >
        <table className="w-full min-w-max font-mono text-xs">
          <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2 font-normal">id</th>
              <th className="px-3 py-2 font-normal">ip hint</th>
              <th className="px-3 py-2 font-normal">user-agent</th>
              <th className="px-3 py-2 font-normal">created</th>
              <th className="px-3 py-2 font-normal">expires</th>
            </tr>
          </thead>
          <tbody>
            {user.sessions.map((s) => (
              <tr
                key={s.id}
                className="border-t border-[var(--color-border-subtle)]"
              >
                <td className="px-3 py-2 text-[var(--color-text)]">
                  <code title={s.id}>{truncateId(s.id)}</code>
                </td>
                <td className="px-3 py-2 text-[var(--color-text-muted)]">
                  {s.ipHashHint ? (
                    <code className="text-[10px]">{s.ipHashHint}…</code>
                  ) : (
                    <span className="text-[var(--color-text-subtle)]">—</span>
                  )}
                </td>
                <td className="max-w-[28rem] truncate px-3 py-2 text-[var(--color-text-muted)]">
                  {s.userAgent ?? (
                    <span className="text-[var(--color-text-subtle)]">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-[var(--color-text-muted)]">
                  {relative(s.createdAt)}
                </td>
                <td className="px-3 py-2 text-[var(--color-text-muted)]">
                  {relative(s.expiresAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title="linked accounts"
        emptyHint="no linked accounts"
        empty={user.accounts.length === 0}
      >
        <table className="w-full min-w-max font-mono text-xs">
          <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2 font-normal">provider</th>
              <th className="px-3 py-2 font-normal">upstream id</th>
              <th className="px-3 py-2 font-normal">linked</th>
            </tr>
          </thead>
          <tbody>
            {user.accounts.map((a) => (
              <tr
                key={a.id}
                className="border-t border-[var(--color-border-subtle)]"
              >
                <td className="px-3 py-2 text-[var(--color-text)]">
                  <span className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                    {a.providerId}
                  </span>
                </td>
                <td className="px-3 py-2 text-[var(--color-text-muted)]">
                  <code className="text-[10px]" title={a.providerAccountId}>
                    {truncateId(a.providerAccountId)}
                  </code>
                </td>
                <td className="px-3 py-2 text-[var(--color-text-muted)]">
                  {relative(a.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title="recent audit"
        emptyHint="no audit entries"
        empty={user.audit.length === 0}
      >
        <table className="w-full min-w-max font-mono text-xs">
          <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2 font-normal">action</th>
              <th className="px-3 py-2 font-normal">when</th>
              <th className="px-3 py-2 font-normal">metadata</th>
            </tr>
          </thead>
          <tbody>
            {user.audit.map((r) => (
              <tr
                key={r.id}
                className="border-t border-[var(--color-border-subtle)]"
              >
                <td className="px-3 py-2 text-[var(--color-text)]">{r.action}</td>
                <td className="px-3 py-2 text-[var(--color-text-muted)]">
                  {relative(r.occurredAt)}
                </td>
                <td className="px-3 py-2 text-[var(--color-text-muted)]">
                  {Object.keys(r.metadata).length === 0 ? (
                    <span className="text-[var(--color-text-subtle)]">—</span>
                  ) : (
                    <code className="text-[10px]">
                      {JSON.stringify(r.metadata)}
                    </code>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">
        revoke / unlink / hard-delete actions land in step 7 (the SDK exposes them via the
        same admin endpoints).
      </p>
    </section>
  );
}

interface PanelProps {
  title: string;
  empty: boolean;
  emptyHint: string;
  children: React.ReactNode;
}

function Panel({ title, empty, emptyHint, children }: PanelProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-mono text-sm text-[var(--color-text)]">{title}</h3>
      {empty ? (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 text-center font-mono text-xs text-[var(--color-text-muted)]">
          {emptyHint}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          {children}
        </div>
      )}
    </div>
  );
}

function truncateId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function relative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const deltaMs = Date.now() - then;
  if (deltaMs < 0) {
    const ahead = -deltaMs;
    if (ahead < 60 * 60_000) return `in ${Math.floor(ahead / 60_000)}m`;
    if (ahead < 24 * 60 * 60_000) return `in ${Math.floor(ahead / (60 * 60_000))}h`;
    return `in ${Math.floor(ahead / (24 * 60 * 60_000))}d`;
  }
  if (deltaMs < 60_000) return 'just now';
  if (deltaMs < 60 * 60_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  if (deltaMs < 24 * 60 * 60_000) return `${Math.floor(deltaMs / (60 * 60_000))}h ago`;
  if (deltaMs < 30 * 24 * 60 * 60_000) return `${Math.floor(deltaMs / (24 * 60 * 60_000))}d ago`;
  return iso.slice(0, 10);
}
