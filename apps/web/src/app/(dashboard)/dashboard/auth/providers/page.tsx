import {
  BrivenEngineProvidersForm,
  BrivenEngineSmsForm,
} from './providers-form';

export const metadata = { title: 'Briven Auth · providers' };
export const dynamic = 'force-dynamic';

/**
 * Providers + SMS secrets for briven-engine.
 */
export default async function ProvidersPage() {
  let providers: Array<{ thirdPartyId: string; name: string; help: string }> =
    [];

  try {
    const origin =
      process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN?.replace(/\/$/, '') ||
      process.env.BRIVEN_API_ORIGIN?.replace(/\/$/, '') ||
      'https://api.briven.tech';
    const res = await fetch(`${origin}/v1/auth-core/providers`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const body = (await res.json()) as { providers?: typeof providers };
      providers = body.providers ?? [];
    }
  } catch {
    /* catalog offline */
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <p
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: 'var(--auth-accent, #e6b800)' }}
        >
          briven-engine · providers + SMS
        </p>
        <h2 className="mt-1 font-mono text-sm text-[var(--color-text)]">
          Sign-in methods
        </h2>
        <p className="mt-2 max-w-xl font-mono text-xs text-[var(--color-text-muted)]">
          Save Google/GitHub (and friends) secrets, and SMS for phone codes.
          Secrets are locked per project. Engine name: briven-engine.
        </p>
      </div>

      {providers.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {providers.map((p) => (
            <li
              key={p.thirdPartyId}
              className="rounded-md border p-3"
              style={{
                borderColor: 'var(--auth-accent-border, var(--color-border))',
              }}
            >
              <div className="font-mono text-sm text-[var(--color-text)]">
                {p.name}
              </div>
              <div className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                {p.thirdPartyId}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          Catalog offline — forms still work when API is local.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <BrivenEngineProvidersForm />
        <BrivenEngineSmsForm />
      </div>
    </section>
  );
}
