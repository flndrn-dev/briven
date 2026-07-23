import {
  fetchAuthCoreInfo,
  fetchAuthDashboard,
} from './lib/auth-api';

export const metadata = { title: 'Auth' };
export const dynamic = 'force-dynamic';

/**
 * Auth overview — engine status + live counts from Doltgres.
 */
export default async function BrivenAuthOverviewPage() {
  const info = await fetchAuthCoreInfo();
  const dash = await fetchAuthDashboard();

  const engine = info?.engine ?? 'briven-engine';
  const version = info?.engineVersion ?? '—';
  const storage = info?.storage ?? 'doltgres';
  const database = info?.database ?? 'briven_engine';
  const appLoginReady = info?.appLoginReady === true;
  const methods = Array.isArray(info?.loginMethods) ? info!.loginMethods! : [];
  const message = info?.message ?? (info ? 'engine replied' : 'could not reach engine');

  const counts = dash.ok
    ? dash.data.counts
    : { users: 0, sessions: 0, tenants: 0, thirdPartyLinks: 0, passwordlessCodesActive: 0 };

  return (
    <section>
      <header className="mb-8">
        <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
          Auth
        </h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          sign-in for your apps · {engine} {version}
        </p>
      </header>

      <div
        className="mb-6 rounded-md border p-6"
        style={{
          borderColor: 'var(--auth-accent-border, var(--color-border))',
          background: 'var(--color-surface)',
        }}
      >
        <p
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: 'var(--auth-accent, #FFFD74)' }}
        >
          overview
        </p>
        <h2 className="mt-2 font-mono text-sm text-[var(--color-text)]">
          {appLoginReady
            ? 'app login is on (Doltgres)'
            : 'engine not ready yet'}
        </h2>
        <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          Password, codes, Google/GitHub, MFA, and passkeys for apps. Data sits
          in {storage}/{database} next to Briven DB and Briven Pay. Platform
          login to briven.tech is separate.
        </p>
        <p className="mt-3 font-mono text-[11px] text-[var(--color-text-muted)]">
          {message}
        </p>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'users', value: counts.users },
          { label: 'sessions', value: counts.sessions },
          { label: 'tenants', value: counts.tenants },
          { label: 'social links', value: counts.thirdPartyLinks },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4"
          >
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
              {c.label}
            </p>
            <p className="mt-1 font-mono text-2xl text-[var(--color-text)]">
              {dash.ok ? c.value : '—'}
            </p>
          </div>
        ))}
      </div>

      {!dash.ok && dash.status === 401 ? (
        <p className="mb-6 font-mono text-xs text-[var(--color-text-muted)]">
          sign in to see live counts
        </p>
      ) : null}

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          methods
        </h2>
        {methods.length === 0 ? (
          <p className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
            none reported
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {methods.map((m) => (
              <li
                key={m}
                className="rounded border px-2 py-1 font-mono text-[11px] text-[var(--color-text)]"
                style={{
                  borderColor: 'var(--auth-accent-border)',
                  background: 'var(--auth-accent-soft)',
                }}
              >
                {m}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
