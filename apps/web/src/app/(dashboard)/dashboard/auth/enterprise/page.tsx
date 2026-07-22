export const metadata = { title: 'Briven Auth · enterprise' };
export const dynamic = 'force-dynamic';

/**
 * Enterprise — multitenancy / OAuth2 IdP / SAML status for briven-engine.
 */
export default async function EnterprisePage() {
  let recipes: { loaded?: string[]; catalog?: Array<{ id: string; loaded: boolean; title: string }> } | null =
    null;
  let tenants: { tenantIds?: string[]; ok?: boolean; message?: string } | null =
    null;

  try {
    const origin =
      process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN?.replace(/\/$/, '') ||
      process.env.BRIVEN_API_ORIGIN?.replace(/\/$/, '') ||
      'https://api.briven.tech';
    const [rRes, tRes] = await Promise.all([
      fetch(`${origin}/v1/auth-core/recipes`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      }),
      fetch(`${origin}/v1/auth-core/tenants`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      }),
    ]);
    if (rRes.ok) recipes = (await rRes.json()) as typeof recipes;
    if (tRes.ok || tRes.status === 503) {
      tenants = (await tRes.json()) as typeof tenants;
    }
  } catch {
    /* offline */
  }

  const enterpriseIds = [
    'multitenancy',
    'oauth2provider',
    'openid',
    'jwt',
    'saml',
  ];

  return (
    <section className="flex flex-col gap-4">
      <p
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--auth-accent, #e6b800)' }}
      >
        briven-engine · enterprise
      </p>
      <h2 className="font-mono text-sm text-[var(--color-text)]">
        Multi-project, SAML, login-as-IdP
      </h2>
      <p className="max-w-xl font-mono text-xs text-[var(--color-text-muted)]">
        Enterprise pieces of briven-engine. Each Briven project maps to its own
        engine tenant so users never mix.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {enterpriseIds.map((id) => {
          const loaded = recipes?.loaded?.includes(id) ?? false;
          const title =
            recipes?.catalog?.find((c) => c.id === id)?.title ?? id;
          return (
            <li
              key={id}
              className="rounded-md border p-3 font-mono text-xs"
              style={{
                borderColor: 'var(--auth-accent-border, var(--color-border))',
                opacity: loaded ? 1 : 0.55,
              }}
            >
              <div className="text-[var(--color-text)]">{title}</div>
              <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                {id} · {loaded ? 'loaded' : 'catalog only'}
              </div>
            </li>
          );
        })}
      </ul>
      <div
        className="rounded-md border p-3 font-mono text-xs"
        style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
      >
        <div className="text-[var(--color-text)]">Tenants in briven-engine</div>
        <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
          {!tenants
            ? 'could not query'
            : tenants.ok
              ? `${(tenants.tenantIds ?? []).length} tenant(s): ${(tenants.tenantIds ?? []).slice(0, 8).join(', ') || 'none'}`
              : tenants.message ?? 'not ready'}
        </div>
      </div>
    </section>
  );
}
