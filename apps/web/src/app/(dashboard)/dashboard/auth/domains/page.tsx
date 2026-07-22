export const metadata = { title: 'Briven Auth · domains' };
export const dynamic = 'force-dynamic';

/**
 * Domains — first-party proxy + app domain rules for briven-engine.
 */
export default function DomainsPage() {
  return (
    <section className="flex flex-col gap-4">
      <p
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--auth-accent, #e6b800)' }}
      >
        briven-engine · domains
      </p>
      <h2 className="font-mono text-sm text-[var(--color-text)]">
        App domain + first-party proxy
      </h2>
      <p className="max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
        Login cookies must live on <strong className="text-[var(--color-text)]">your app&apos;s
        website address</strong>, not only on Briven&apos;s API. Think of a reception desk
        inside your building: visitors check in at your door, and the desk quietly
        phones the vault (briven-engine) in the back.
      </p>
      <ol className="flex max-w-2xl list-decimal flex-col gap-2 pl-5 font-mono text-xs text-[var(--color-text-muted)]">
        <li>
          Your app exposes <code className="text-[var(--color-text)]">/api/auth/*</code>
        </li>
        <li>
          That path forwards to{' '}
          <code className="text-[var(--color-text)]">
            https://api.briven.tech/v1/auth-core/fdi/*
          </code>
        </li>
        <li>
          Use <code className="text-[var(--color-text)]">@briven/auth/engine</code> with{' '}
          <code className="text-[var(--color-text)]">apiBasePath: &apos;/api/auth&apos;</code>
        </li>
      </ol>
      <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
        Domain allow-list UI (which websites may use a project) is next. No deploy
        until complete Briven Auth is built.
      </p>
    </section>
  );
}
