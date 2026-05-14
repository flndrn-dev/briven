import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../lib/api';

interface Entry {
  id: string;
  email: string;
  invitedBy: string | null;
  invitedAt: string;
  acceptedAt: string | null;
  notes: string | null;
}

interface LaunchStatus {
  openSignups: boolean;
}

export const dynamic = 'force-dynamic';

export default async function AllowlistPage() {
  const [entriesResult, launchResult] = await Promise.all([
    apiJson<{ entries: Entry[] }>('/v1/admin/signup-allowlist'),
    apiJson<LaunchStatus>('/v1/admin/launch-status').catch(() => null),
  ]);
  const entries = entriesResult.entries;
  const openSignups = launchResult?.openSignups ?? false;

  async function add(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    const notes = String(formData.get('notes') ?? '').trim() || undefined;
    const res = await apiFetch('/v1/admin/signup-allowlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, ...(notes ? { notes } : {}) }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `add failed: ${res.status}`);
    }
    revalidatePath('/dashboard/admin/allowlist');
  }

  async function remove(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '');
    const res = await apiFetch(
      `/v1/admin/signup-allowlist/${encodeURIComponent(email)}`,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`remove failed: ${res.status}`);
    }
    revalidatePath('/dashboard/admin/allowlist');
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">signup allowlist</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          while <code>BRIVEN_OPEN_SIGNUPS</code> is{' '}
          <span
            className={
              openSignups ? 'text-[var(--color-primary)]' : 'text-[var(--color-warning)]'
            }
          >
            {openSignups ? 'true (open)' : 'false (invite-only)'}
          </span>
          , only emails on this list can sign up. add a beta tester here, send them the magic-link
          flow at <code>/signin</code>, and the row stamps <code>acceptedAt</code> the moment they
          claim it.
        </p>
      </header>

      <form
        action={add}
        className="grid grid-cols-1 gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 md:grid-cols-[2fr_2fr_auto] md:items-end"
      >
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            email
          </span>
          <input
            required
            type="email"
            name="email"
            placeholder="alice@example.com"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            notes (optional)
          </span>
          <input
            name="notes"
            placeholder="founder of acme.dev — met at handlr launch"
            maxLength={500}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 font-sans text-sm text-[var(--color-text-inverse)] transition-colors hover:bg-[var(--color-primary-hover)]"
        >
          add
        </button>
      </form>

      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          entries ({entries.length})
        </h3>
        {entries.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
            no allowlist entries yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-sm text-[var(--color-text)]">{e.email}</span>
                    {e.acceptedAt ? (
                      <span className="rounded-full border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-primary)]">
                        claimed
                      </span>
                    ) : (
                      <span className="rounded-full border border-[var(--color-warning)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-warning)]">
                        pending
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-[var(--color-text-subtle)]">
                    invited {formatTimestamp(e.invitedAt)}
                    {e.acceptedAt ? ` · claimed ${formatTimestamp(e.acceptedAt)}` : ''}
                  </p>
                  {e.notes ? (
                    <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
                      {e.notes}
                    </p>
                  ) : null}
                </div>
                <form action={remove}>
                  <input type="hidden" name="email" value={e.email} />
                  <button
                    type="submit"
                    className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
                  >
                    remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' utc';
}
