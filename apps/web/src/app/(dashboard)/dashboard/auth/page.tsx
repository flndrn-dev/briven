import Link from 'next/link';

import { fetchAuthDashboard } from './lib/auth-api';

export const metadata = { title: 'Auth' };
export const dynamic = 'force-dynamic';

/**
 * Auth overview — same layout language as the main dashboard home:
 * title with count, card grid + quick actions, recent list below.
 */
export default async function BrivenAuthHomePage() {
  const dash = await fetchAuthDashboard();

  const users = dash.ok ? dash.data.counts.users : null;
  const sessions = dash.ok ? dash.data.counts.sessions : null;
  const tenants = dash.ok ? dash.data.counts.tenants : null;
  const social = dash.ok ? dash.data.counts.thirdPartyLinks : null;
  const methods = dash.ok ? dash.data.methods : null;
  const recent = dash.ok ? dash.data.recentUsers : [];

  const title =
    users == null
      ? 'Auth'
      : users === 0
        ? 'no sign-ins yet'
        : `${users} user${users === 1 ? '' : 's'} in Auth`;

  const methodCards = methods
    ? [
        { label: 'password', on: methods.emailPassword },
        { label: 'magic link', on: methods.passwordlessEmail },
        { label: 'SMS', on: methods.passwordlessSms },
        { label: 'Google', on: methods.google },
        { label: 'GitHub', on: methods.github },
        { label: 'passkey', on: methods.webauthn },
        { label: '2FA', on: methods.mfa },
      ]
    : [];

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          sign-in for your apps
        </p>
        <h1 className="font-sans text-2xl font-medium tracking-[-0.02em] text-[var(--color-text)]">
          {title}
        </h1>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="flex flex-col gap-4">
          <header className="flex items-center justify-between">
            <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
              at a glance
            </h2>
            <Link
              href="/dashboard/auth/projects"
              className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              show projects →
            </Link>
          </header>

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="users" value={users == null ? '—' : String(users)} highlight />
            <StatCard
              label="sessions"
              value={sessions == null ? '—' : String(sessions)}
            />
            <StatCard
              label="projects"
              value={tenants == null ? '—' : String(tenants)}
            />
          </ul>

          {methodCards.length > 0 ? (
            <>
              <header className="mt-2">
                <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
                  sign-in methods
                </h2>
              </header>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {methodCards.map((m) => (
                  <li key={m.label}>
                    <div className="flex flex-col gap-1.5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-sans text-sm text-[var(--color-text)]">
                          {m.label}
                        </span>
                        <span
                          className="font-mono text-[10px] uppercase tracking-wider"
                          style={{
                            color: m.on
                              ? 'var(--auth-accent, #e6b800)'
                              : 'var(--color-text-subtle)',
                          }}
                        >
                          {m.on ? 'on' : 'off'}
                        </span>
                      </div>
                      <p className="font-mono text-xs text-[var(--color-text-muted)]">
                        {m.on ? 'available for your apps' : 'not turned on yet'}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <aside className="flex flex-col gap-4">
          <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
            quick actions
          </h2>
          <div className="flex flex-col gap-2">
            <QuickLink href="/dashboard/auth/projects" label="projects" />
            <QuickLink href="/dashboard/auth/users" label="users" />
            <QuickLink href="/dashboard/auth/sessions" label="sessions" />
            <QuickLink href="/dashboard/auth/keys" label="keys" />
            <QuickLink href="/dashboard/auth/providers" label="providers" />
            <QuickLink href="/dashboard/auth/security" label="security" />
          </div>
          {social != null ? (
            <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              {social} social link{social === 1 ? '' : 's'} connected
            </p>
          ) : null}
        </aside>
      </div>

      <section className="flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
            recent users
          </h2>
          <Link
            href="/dashboard/auth/users"
            className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            show all →
          </Link>
        </header>

        {!dash.ok && dash.status === 401 ? (
          <p className="font-mono text-xs text-[var(--color-text-muted)]">
            sign in to see users.
          </p>
        ) : recent.length === 0 ? (
          <p className="font-mono text-xs text-[var(--color-text-muted)]">
            no users yet. when people sign in to your apps, they show up here.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {recent.slice(0, 10).map((u) => (
              <li
                key={u.id}
                className="flex items-baseline justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-[var(--color-text)]">
                    {(u.emails ?? [])[0] ||
                      (u.phoneNumbers ?? [])[0] ||
                      u.id}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                    {u.id}
                  </p>
                </div>
                <time className="shrink-0 font-mono text-[10px] text-[var(--color-text-subtle)]">
                  {formatRelative(u.timeJoined)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <li className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {label}
      </p>
      <p
        className="mt-2 font-sans text-2xl font-medium tracking-tight text-[var(--color-text)]"
        style={
          highlight ? { color: 'var(--auth-accent, #e6b800)' } : undefined
        }
      >
        {value}
      </p>
    </li>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
    >
      <span>{label}</span>
      <span aria-hidden className="text-[var(--color-text-subtle)]">
        →
      </span>
    </Link>
  );
}

function formatRelative(ms: number): string {
  const diffSec = Math.round((Date.now() - ms) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.round(diffSec / 86400)}d ago`;
  return new Date(ms).toLocaleDateString('en-GB', {
    month: 'short',
    day: 'numeric',
  });
}
