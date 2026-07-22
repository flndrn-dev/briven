import { fetchAuthDashboard, fetchAuthRecipes } from '../lib/auth-api';

export const metadata = { title: 'Briven Auth · sessions' };
export const dynamic = 'force-dynamic';

/**
 * Sessions + methods — Doltgres counts + recipe catalog.
 */
export default async function SessionsPage() {
  const [dash, recipes] = await Promise.all([
    fetchAuthDashboard(),
    fetchAuthRecipes(),
  ]);

  return (
    <section className="flex flex-col gap-4">
      <p
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--auth-accent, #e6b800)' }}
      >
        briven-engine · sessions & methods · doltgres
      </p>
      <h2 className="font-mono text-sm text-[var(--color-text)]">
        What is live in the vault
      </h2>

      {dash.ok ? (
        <dl className="grid gap-2 sm:grid-cols-3">
          <Tile label="active sessions" value={String(dash.data.counts.sessions)} />
          <Tile label="users" value={String(dash.data.counts.users)} />
          <Tile
            label="pending OTP/links"
            value={String(dash.data.counts.passwordlessCodesActive)}
          />
        </dl>
      ) : (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          {dash.status === 401
            ? 'Sign in to briven.tech to see session counts from Doltgres.'
            : dash.message}
        </p>
      )}

      <h3 className="mt-2 font-mono text-xs text-[var(--color-text)]">
        methods / recipes
      </h3>
      {!recipes ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          Could not load recipe catalog.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {(recipes.catalog ?? []).map((r) => (
            <li
              key={r.id}
              className="rounded-md border p-3 font-mono text-xs"
              style={{
                borderColor: 'var(--auth-accent-border, var(--color-border))',
                opacity: r.loaded ? 1 : 0.55,
              }}
            >
              <div className="text-[var(--color-text)]">{r.title}</div>
              <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                {r.id} · phase {r.phase}
                {r.sms ? ' · SMS' : ''} · {r.loaded ? 'loaded' : 'catalog'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-md border p-3 font-mono text-xs"
      style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
    >
      <div className="text-[10px] uppercase text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className="mt-1 text-sm text-[var(--color-text)]">{value}</div>
    </div>
  );
}
