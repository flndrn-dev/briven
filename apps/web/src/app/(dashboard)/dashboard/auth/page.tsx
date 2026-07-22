import { fetchAuthCoreInfo } from './lib/auth-api';

export const metadata = { title: 'Auth' };
export const dynamic = 'force-dynamic';

/**
 * Phase 1 (Option B) Auth shell — briven-engine version + not ready for app login.
 * Same dashboard design language as projects/overview. Butter yellow via layout.
 */
export default async function BrivenAuthPhase1Page() {
  const info = await fetchAuthCoreInfo();

  const engine = info?.engine ?? 'briven-engine';
  const version = info?.engineVersion ?? '—';
  const storage = info?.storage ?? 'doltgres';
  const database = info?.database ?? 'briven_engine';
  const engineOk = info?.ok === true;
  const schemaReady = info?.schemaReady === true;
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
          Phase 1 shell
        </p>

        <h2 className="mt-3 font-mono text-sm text-[var(--color-text)]">
          not ready for app login yet
        </h2>
        <p className="mt-2 max-w-lg font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          Briven Auth is live as a shell only. Apps (mavi, handlr, konnos, …)
          cannot sign users in yet. Platform login to briven.tech is unchanged.
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
            <dt className="text-[var(--color-text-muted)]">engine health</dt>
            <dd className="mt-1 text-[var(--color-text)]">
              {engineOk ? 'ok' : 'not ready'}
              {schemaReady ? ' · schema ready' : ''}
            </dd>
          </div>
        </dl>

        <p className="mt-4 font-mono text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          {message}
          {info?.buildSha && info.buildSha !== 'dev' ? (
            <span className="mt-1 block opacity-70">build {info.buildSha.slice(0, 7)}</span>
          ) : null}
        </p>
      </div>
    </section>
  );
}
