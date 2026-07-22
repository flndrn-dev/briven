export const metadata = { title: 'Auth · enterprise' };
export const dynamic = 'force-dynamic';

type RecipesPayload = {
  loaded?: string[];
  catalog?: Array<{ id: string; loaded: boolean; title: string }>;
};

type TenantsPayload = {
  tenantIds?: string[];
  ok?: boolean;
  message?: string;
};

/**
 * Enterprise — multi-project, SAML, company login options.
 */
export default async function EnterprisePage() {
  let recipes: RecipesPayload | null = null;
  let tenants: TenantsPayload | null = null;

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
    if (rRes.ok) recipes = (await rRes.json()) as RecipesPayload;
    if (tRes.ok || tRes.status === 503) {
      tenants = (await tRes.json()) as TenantsPayload;
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
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-sans text-2xl font-medium tracking-[-0.02em] text-[var(--color-text)]">
          enterprise
        </h1>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          company login, SAML, multi-project islands
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2">
        {enterpriseIds.map((id) => {
          const loaded = recipes?.loaded?.includes(id) ?? false;
          const title =
            recipes?.catalog?.find((c) => c.id === id)?.title ?? id;
          return (
            <li
              key={id}
              className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4"
              style={{ opacity: loaded ? 1 : 0.55 }}
            >
              <p className="font-mono text-sm text-[var(--color-text)]">{title}</p>
              <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                {loaded ? 'available' : 'coming soon'}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
        <p className="font-mono text-sm text-[var(--color-text)]">
          project islands
        </p>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          {!tenants
            ? 'could not load right now'
            : tenants.ok
              ? `${(tenants.tenantIds ?? []).length} island${(tenants.tenantIds ?? []).length === 1 ? '' : 's'} active`
              : tenants.message ?? 'not ready'}
        </p>
      </div>
    </section>
  );
}
