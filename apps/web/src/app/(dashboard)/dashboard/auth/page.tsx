import { fetchAuthCoreInfo } from './lib/auth-api';

export const metadata = { title: 'Auth' };
export const dynamic = 'force-dynamic';

/**
 * Auth overview — briven-engine on Doltgres (Option B).
 * Phase 2: password · Phase 3 local: passwordless email/SMS + magic link.
 */
export default async function BrivenAuthOverviewPage() {
  const info = await fetchAuthCoreInfo();

  const engine = info?.engine ?? 'briven-engine';
  const version = info?.engineVersion ?? '—';
  const storage = info?.storage ?? 'doltgres';
  const database = info?.database ?? 'briven_engine';
  const engineOk = info?.ok === true;
  const appLoginReady = info?.appLoginReady === true;
  const methods = Array.isArray(info?.loginMethods)
    ? info!.loginMethods!
    : appLoginReady
      ? ['emailpassword']
      : [];
  const message =
    info?.message ??
    (info
      ? 'engine replied'
      : 'could not reach engine status — try again after deploy');

  return (
    <section>
      <header className="mb-8">
        <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
          Auth
        </h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          sign-in for your apps
        </p>
      </header>

      <div
        className="rounded-md border p-8"
        style={{
          borderColor: 'var(--auth-accent-border, var(--color-border))',
          background: 'var(--color-surface)',
        }}
      >
        <p
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: 'var(--auth-accent, #FFFD74)' }}
        >
          Phase 3 · password + passwordless
        </p>

        <h2 className="mt-3 font-mono text-sm text-[var(--color-text)]">
          {appLoginReady
            ? 'password, email OTP, magic link, SMS OTP (Doltgres)'
            : 'engine not ready yet'}
        </h2>
        <p className="mt-2 max-w-lg font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          Apps can sign users in with email/password, email code, magic link, or
          SMS code. Sessions live in Doltgres next to Briven DB and Briven Pay.
          Google and MFA come later. Platform login to briven.tech is separate.
        </p>

        <dl className="mt-6 grid gap-3 font-mono text-xs sm:grid-cols-2">
          <div className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-3">
            <dt className="text-[var(--color-text-muted)]">engine</dt>
            <dd className="mt-1 text-[var(--color-text)]">{engine}</dd>
          </div>
          <div className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-3">
            <dt className="text-[var(--color-text-muted)]">version</dt>
            <dd className="mt-1 text-[var(--color-text)]">{version}</dd>
          </div>
          <div className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-3">
            <dt className="text-[var(--color-text-muted)]">storage</dt>
            <dd className="mt-1 text-[var(--color-text)]">
              {storage} / {database}
            </dd>
          </div>
          <div className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-3">
            <dt className="text-[var(--color-text-muted)]">app login</dt>
            <dd className="mt-1 text-[var(--color-text)]">
              {appLoginReady ? 'open (password)' : engineOk ? 'partial' : 'closed'}
              {methods.length > 0 ? ` · ${methods.join(', ')}` : ''}
            </dd>
          </div>
        </dl>

        <p className="mt-4 font-mono text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          {message}
          {info?.buildSha && info.buildSha !== 'dev' ? (
            <span className="mt-1 block opacity-70">
              build {info.buildSha.slice(0, 7)}
            </span>
          ) : null}
        </p>

        <div className="mt-6 rounded border border-dashed border-[var(--color-border)] p-4 font-mono text-[11px] text-[var(--color-text-muted)]">
          <p className="text-[var(--color-text)]">For apps (first-party proxy)</p>
          <p className="mt-2">
            POST /v1/auth-core/fdi/signup · /signin · /signout
          </p>
          <p>
            POST /v1/auth-core/fdi/signinup/code · /signinup/code/consume
          </p>
          <p>GET /v1/auth-core/session/me</p>
          <p className="mt-2">
            Send header <code className="text-[var(--color-text)]">x-briven-project-id</code>{' '}
            so each app keeps its own users.
          </p>
        </div>
      </div>
    </section>
  );
}
