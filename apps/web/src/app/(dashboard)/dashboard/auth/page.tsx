import Link from 'next/link';

import {
  fetchAuthCoreInfo,
  fetchAuthDashboard,
  fetchAuthRecipes,
} from './lib/auth-api';

export const metadata = { title: 'Briven Auth' };
export const dynamic = 'force-dynamic';

/**
 * Yellow Authentication overview — live briven-engine + Doltgres stats.
 */
export default async function BrivenAuthHomePage() {
  const [core, dash, recipes] = await Promise.all([
    fetchAuthCoreInfo(),
    fetchAuthDashboard(),
    fetchAuthRecipes(),
  ]);

  const storage =
    (core as { storage?: string } | null)?.storage ??
    (dash.ok ? dash.data.storage : null) ??
    'doltgres';

  return (
    <section className="flex flex-col gap-6">
      <div
        className="rounded-md border p-6 md:p-8"
        style={{
          borderColor: 'var(--auth-accent-border, var(--color-border))',
          background: 'var(--color-surface-raised)',
        }}
      >
        <p
          className="font-mono text-xs uppercase tracking-widest"
          style={{ color: 'var(--auth-accent, #e6b800)' }}
        >
          briven-engine · authentication · doltgres
        </p>
        <h2 className="mt-3 font-mono text-base text-[var(--color-text)]">
          Briven Auth product home
        </h2>
        <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          Independent login product for customer apps. All Auth data lives on{' '}
          <strong className="text-[var(--color-text)]">Doltgres</strong> (
          <code className="text-[var(--color-text)]">briven_engine</code>
          ). Not finished until live proof and your OK. No deploy until then.
        </p>

        <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label="engine"
            value={
              core == null
                ? 'API unreachable'
                : core.ok
                  ? `${core.engine ?? 'briven-engine'} · ready`
                  : core.message ?? 'not ready'
            }
          />
          <Stat label="storage" value={storage} />
          <Stat
            label="users (Doltgres)"
            value={
              dash.ok
                ? String(dash.data.counts.users)
                : dash.status === 401
                  ? 'sign in to see counts'
                  : '—'
            }
          />
          <Stat
            label="active sessions"
            value={dash.ok ? String(dash.data.counts.sessions) : '—'}
          />
          <Stat
            label="tenants / projects"
            value={dash.ok ? String(dash.data.counts.tenants) : '—'}
          />
          <Stat
            label="social links"
            value={dash.ok ? String(dash.data.counts.thirdPartyLinks) : '—'}
          />
        </dl>

        {dash.ok ? (
          <div className="mt-6">
            <p className="font-mono text-[10px] uppercase text-[var(--color-text-muted)]">
              sign-in methods (engine)
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {Object.entries(dash.data.methods).map(([k, on]) => (
                <li
                  key={k}
                  className="rounded border px-2 py-1 font-mono text-[10px]"
                  style={{
                    borderColor: 'var(--auth-accent-border)',
                    opacity: on ? 1 : 0.45,
                  }}
                >
                  {k} · {on ? 'on' : 'off'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {recipes?.catalog ? (
          <p className="mt-4 font-mono text-[10px] text-[var(--color-text-muted)]">
            recipes loaded: {(recipes.loaded ?? []).join(', ') || 'none'}
            {recipes.smsIncluded ? ' · SMS included' : ''}
          </p>
        ) : null}

        {!dash.ok && dash.status === 401 ? (
          <p className="mt-4 font-mono text-xs text-[var(--color-text-muted)]">
            Sign in to briven.tech to see live user counts from Doltgres.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3 font-mono text-xs">
        <Link
          href="/dashboard/auth/users"
          className="underline"
          style={{ color: 'var(--auth-accent)' }}
        >
          users →
        </Link>
        <Link
          href="/dashboard/auth/sessions"
          className="underline"
          style={{ color: 'var(--auth-accent)' }}
        >
          sessions & methods →
        </Link>
        <Link
          href="/dashboard/auth/providers"
          className="underline"
          style={{ color: 'var(--auth-accent)' }}
        >
          providers →
        </Link>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-md border p-3"
      style={{ borderColor: 'var(--auth-accent-border)' }}
    >
      <dt className="font-mono text-[10px] uppercase text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-sm text-[var(--color-text)]">{value}</dd>
    </div>
  );
}
