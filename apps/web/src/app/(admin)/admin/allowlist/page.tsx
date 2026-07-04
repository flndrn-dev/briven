import { MailIcon } from '@/components/ui/mail';
import { UsersIcon } from '@/components/ui/users';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { AllowlistAddForm, AllowlistRemoveButton } from './allowlist-controls';

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

function publicApiOrigin(): string {
  return process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
}

export default async function AllowlistPage() {
  const [entriesResult, launchResult] = await Promise.all([
    apiJson<{ entries: Entry[] }>('/v1/admin/signup-allowlist'),
    apiJson<LaunchStatus>('/v1/admin/launch-status').catch(() => null),
  ]);
  const entries = entriesResult.entries;
  const openSignups = launchResult?.openSignups ?? false;
  const apiOrigin = publicApiOrigin();

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <UsersIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">signup allowlist</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          while <code>BRIVEN_OPEN_SIGNUPS</code> is{' '}
          <span
            className={
              openSignups ? 'text-[var(--color-primary)]' : 'text-[var(--color-warning)]'
            }
          >
            {openSignups ? 'true (open)' : 'false (invite-only)'}
          </span>
          , only emails on this list can sign up. mutations require fresh step-up auth — the
          prompt appears inline on stale sessions.
        </p>
      </header>

      <AllowlistAddForm apiOrigin={apiOrigin} />

      <Section title={`entries · ${entries.length}`} icon={<MailIcon size={16} />}>
        {entries.length === 0 ? (
          <EmptyState
            icon={<MailIcon size={28} />}
            title="no allowlist entries yet"
            message="add the first email above to invite someone into the beta."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-sm text-[var(--color-text)]">{e.email}</span>
                    {e.acceptedAt ? (
                      <span className="rounded-full border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-primary)]">
                        claimed
                      </span>
                    ) : (
                      <span className="rounded-full border border-[var(--color-warning)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-warning)]">
                        pending
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 font-mono text-[11px] text-[var(--color-text-subtle)]">
                    invited {formatTimestamp(e.invitedAt)}
                    {e.acceptedAt ? ` · claimed ${formatTimestamp(e.acceptedAt)}` : ''}
                  </p>
                  {e.notes ? (
                    <p className="mt-1.5 font-mono text-xs text-[var(--color-text-muted)]">
                      {e.notes}
                    </p>
                  ) : null}
                </div>
                <AllowlistRemoveButton email={e.email} apiOrigin={apiOrigin} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = toValidDate(iso);
  return d ? d.toISOString().replace('T', ' ').slice(0, 16) + ' utc' : '—';
}
