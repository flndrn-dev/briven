import Link from 'next/link';

import { apiJson } from '../../../../../../../lib/api';

interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  ipAddressHashHint: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

interface AuditResponse {
  items: AuditEntry[];
  nextCursor: string | null;
}

interface AuthStateResponse {
  enabled: boolean;
  config: { providers: Record<string, unknown>; branding: Record<string, unknown> };
}

export const metadata = { title: 'auth · audit' };
export const dynamic = 'force-dynamic';

export default async function AuthAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const cursor = asString(sp.cursor);
  const action = asString(sp.action);
  const userId = asString(sp.userId);

  const state = await apiJson<AuthStateResponse>(`/v1/projects/${id}/auth/config`).catch(
    () => null,
  );
  if (!state || !state.enabled) {
    return (
      <section className="flex flex-col gap-6">
        <header>
          <h2 className="font-mono text-lg tracking-tight">auth · audit</h2>
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
  if (action) qs.set('action', action);
  if (userId) qs.set('userId', userId);
  const data = await apiJson<AuditResponse>(
    `/v1/projects/${id}/auth/audit-log?${qs.toString()}`,
  ).catch(() => ({ items: [] as AuditEntry[], nextCursor: null }));

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-lg tracking-tight">auth · audit</h2>
        <p className="mt-1 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          every signup, signin, signout, session revocation, provider link/unlink,
          password reset, and admin action lands here. ip addresses are stored
          hashed and surfaced as 8-char hints only — never as raw addresses.
        </p>
      </header>

      <FilterBar baseHref={`/dashboard/projects/${id}/auth/audit`} action={action} userId={userId} />

      {data.items.length === 0 ? (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-xs text-[var(--color-text-muted)]">
          no audit entries match this filter. once your customers sign in, events
          start landing here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full min-w-max font-mono text-xs">
            <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-normal">when</th>
                <th className="px-3 py-2 font-normal">action</th>
                <th className="px-3 py-2 font-normal">user</th>
                <th className="px-3 py-2 font-normal">ip hint</th>
                <th className="px-3 py-2 font-normal">user agent</th>
                <th className="px-3 py-2 font-normal">metadata</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr
                  key={e.id}
                  className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-raised)]/50"
                >
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">{relative(e.occurredAt)}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--color-text)]">
                      {e.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {e.userId ? <code title={e.userId}>{truncateId(e.userId)}</code> : '—'}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {e.ipAddressHashHint ? <code>{e.ipAddressHashHint}…</code> : '—'}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]" title={e.userAgent ?? ''}>
                    {e.userAgent ? truncateUa(e.userAgent) : '—'}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {Object.keys(e.metadata).length > 0 ? (
                      <code className="text-[10px]">{JSON.stringify(e.metadata)}</code>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-3">
        {data.nextCursor ? (
          <Link
            href={buildQuery({
              base: `/dashboard/projects/${id}/auth/audit`,
              cursor: data.nextCursor,
              action,
              userId,
            })}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >
            next page →
          </Link>
        ) : null}
      </div>
    </section>
  );
}

interface FilterBarProps {
  baseHref: string;
  action?: string;
  userId?: string;
}

function FilterBar({ baseHref, action, userId }: FilterBarProps) {
  const chips: Array<{ label: string; href: string }> = [
    { label: 'all', href: baseHref },
    { label: 'signin', href: `${baseHref}?action=signin` },
    { label: 'signup', href: `${baseHref}?action=signup` },
    { label: 'signout', href: `${baseHref}?action=signout` },
    { label: 'session.revoked', href: `${baseHref}?action=session.revoked` },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
      {chips.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          className={`rounded-full border px-2 py-0.5 text-[10px] ${
            (c.label === 'all' && !action) || c.label === action
              ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
              : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
          }`}
        >
          {c.label}
        </Link>
      ))}
      {userId ? (
        <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">
          user: <code>{truncateId(userId)}</code>{' '}
          <Link href={baseHref} className="ml-1 text-[var(--color-text-error)]">
            ×
          </Link>
        </span>
      ) : null}
    </div>
  );
}

function buildQuery(args: {
  base: string;
  cursor?: string;
  action?: string;
  userId?: string;
}): string {
  const qs = new URLSearchParams();
  if (args.cursor) qs.set('cursor', args.cursor);
  if (args.action) qs.set('action', args.action);
  if (args.userId) qs.set('userId', args.userId);
  const s = qs.toString();
  return s ? `${args.base}?${s}` : args.base;
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

function truncateUa(ua: string): string {
  if (ua.length <= 60) return ua;
  return `${ua.slice(0, 60)}…`;
}

function relative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const deltaMs = Date.now() - then;
  if (deltaMs < 60_000) return 'just now';
  if (deltaMs < 60 * 60_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  if (deltaMs < 24 * 60 * 60_000) return `${Math.floor(deltaMs / (60 * 60_000))}h ago`;
  if (deltaMs < 30 * 24 * 60 * 60_000) return `${Math.floor(deltaMs / (24 * 60 * 60_000))}d ago`;
  return iso.slice(0, 19).replace('T', ' ');
}
