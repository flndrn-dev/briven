import { fetchAuthDashboard, fetchAuthRecipes } from '../lib/auth-api';

export const metadata = { title: 'Auth · sessions' };
export const dynamic = 'force-dynamic';

export default async function SessionsPage() {
  const [dash, recipes] = await Promise.all([
    fetchAuthDashboard(),
    fetchAuthRecipes(),
  ]);

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-sans text-2xl font-medium tracking-[-0.02em] text-[var(--color-text)]">
          sessions
        </h1>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          active sign-ins and available methods
        </p>
      </header>

      {dash.ok ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile label="active sessions" value={String(dash.data.counts.sessions)} />
          <Tile label="users" value={String(dash.data.counts.users)} />
          <Tile
            label="open codes"
            value={String(dash.data.counts.passwordlessCodesActive)}
          />
        </ul>
      ) : (
        <p className="font-mono text-sm text-[var(--color-text-muted)]">
          {dash.status === 401 ? 'sign in to see sessions.' : dash.message}
        </p>
      )}

      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          methods
        </h2>
        {!recipes ? (
          <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
            could not load methods.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {(recipes.catalog ?? [])
              .filter((r) => r.loaded)
              .map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 font-mono text-sm text-[var(--color-text)]"
                >
                  {r.title}
                  {r.sms ? (
                    <span className="ml-2 text-[10px] text-[var(--color-text-muted)]">
                      SMS
                    </span>
                  ) : null}
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {label}
      </p>
      <p className="mt-2 font-sans text-2xl font-medium text-[var(--color-text)]">
        {value}
      </p>
    </li>
  );
}
