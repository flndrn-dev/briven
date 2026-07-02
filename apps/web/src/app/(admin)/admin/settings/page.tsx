import Link from 'next/link';

import { CogIcon } from '@/components/ui/cog';
import { MailIcon } from '@/components/ui/mail';
import { ShieldCheckIcon } from '@/components/ui/shield-check';
import { UsersIcon } from '@/components/ui/users';

import { apiOrigin } from '@/lib/env';
import { getSessionUser } from '@/lib/session';

import { Section } from '../_components/section';
import { StepUpCard } from './step-up-card';

export const metadata = { title: 'settings · admin' };
export const dynamic = 'force-dynamic';

/**
 * Operator settings — deliberately minimal and honest. Shows who is signed
 * in (straight from /v1/me), the live step-up window (from
 * /v1/admin/launch-status), and plainly explains where password + account
 * changes live today. No preference toggles exist yet because no api
 * backs them — nothing here is decorative.
 */
export default async function AdminSettingsPage() {
  // The (admin) layout already gates on getSessionUser().isAdmin, so this
  // re-fetch always resolves for a rendered page.
  const user = await getSessionUser();

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <CogIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">settings</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          who&apos;s at the controls and how the cockpit&apos;s security works. only real,
          working things live here — preference toggles arrive when their apis do.
        </p>
      </header>

      {/* ── signed-in operator ─────────────────────────────────────────── */}
      <Section title="signed-in operator" icon={<UsersIcon size={16} />}>
        {user === null ? (
          <div className="rounded-xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 font-mono text-xs text-[var(--color-text-subtle)]">
            couldn&apos;t load your session — reload the page.
          </div>
        ) : (
          <div className="flex flex-col gap-6 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-lg tracking-tight text-[var(--color-text)]">
                {user.email}
              </span>
              {user.isAdmin ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary-subtle)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]">
                  platform admin
                </span>
              ) : null}
              {user.emailVerified ? (
                <span className="inline-flex rounded-md bg-[var(--color-surface-raised)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                  verified
                </span>
              ) : (
                <span className="inline-flex rounded-md bg-[var(--color-surface-raised)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-warning)]">
                  unverified
                </span>
              )}
            </div>

            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 font-mono text-xs sm:grid-cols-2 xl:grid-cols-3">
              <div className="flex flex-col gap-1">
                <dt className="text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  name
                </dt>
                <dd className="text-[var(--color-text)]">
                  {user.legalName ?? user.name ?? '—'}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  account created
                </dt>
                <dd className="text-[var(--color-text)]">{formatDate(user.createdAt)}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  last sign-in
                </dt>
                <dd className="text-[var(--color-text)]">
                  {user.lastSignIn ? (
                    <>
                      {new Date(user.lastSignIn.at).toLocaleString()}
                      {formatNearBy(user.lastSignIn.nearBy) ? (
                        <span className="text-[var(--color-text-subtle)]">
                          {' '}
                          · {formatNearBy(user.lastSignIn.nearBy)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    'never'
                  )}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </Section>

      {/* ── step-up auth window ────────────────────────────────────────── */}
      <Section title="step-up auth" icon={<ShieldCheckIcon size={16} />}>
        <StepUpCard apiOrigin={apiOrigin} />
      </Section>

      {/* ── passwords & account changes ────────────────────────────────── */}
      <Section title="passwords & account changes" icon={<MailIcon size={16} />}>
        <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 sm:p-8 font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          <p>
            you sign in to this cockpit with email + password at{' '}
            <code className="rounded bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[var(--color-text)]">
              /admin/login
            </code>
            . there is no change-password form in the app yet — the auth service exposes the
            endpoint, but no page uses it. that form is on the roadmap; until it ships, a
            password change means an operator with database access resetting the credential.
          </p>
          <p>
            everything else about your account — changing your sign-in email, profile and billing
            details, account deletion — lives in the user dashboard&apos;s settings page, which
            works for this admin account too.
          </p>
          <p>
            <Link
              href="/dashboard/settings"
              className="text-[var(--color-text-link)] transition hover:text-[var(--color-primary)]"
            >
              open account settings →
            </Link>
          </p>
        </div>
      </Section>
    </div>
  );
}

/* ─── small helpers ──────────────────────────────────────────────────────── */

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatNearBy(
  nearBy: { city: string | null; region: string | null; country: string | null } | null,
): string | null {
  if (!nearBy) return null;
  const place = nearBy.city ?? nearBy.region;
  if (place && nearBy.country) return `${place}, ${nearBy.country}`;
  return place ?? nearBy.country ?? null;
}
