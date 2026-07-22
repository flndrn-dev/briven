import {
  BrivenEngineProvidersForm,
  BrivenEngineSmsForm,
} from './providers-form';

export const metadata = { title: 'Auth · providers' };
export const dynamic = 'force-dynamic';

/**
 * Providers + SMS secrets for Auth sign-in methods.
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
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-sans text-2xl font-medium tracking-[-0.02em] text-[var(--color-text)]">
          providers
        </h1>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          how people sign in — Google, GitHub, SMS, and more
        </p>
      </header>

      {providers.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {providers.map((p) => (
            <li
              key={p.thirdPartyId}
              className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4"
            >
              <p className="font-mono text-sm text-[var(--color-text)]">{p.name}</p>
              <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                {p.thirdPartyId}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          provider list unavailable — you can still save secrets below.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <BrivenEngineProvidersForm />
        <BrivenEngineSmsForm />
      </div>
    </section>
  );
}
