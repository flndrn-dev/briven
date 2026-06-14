import { revalidatePath } from 'next/cache';
import Link from 'next/link';

import { ProfileBillingForm } from '../../../../components/profile-billing-form';
import { apiFetch, apiJson } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';
import { ChangeEmailForm } from './change-email-form';
import { DeleteAccountForm } from './delete-account-form';

interface PendingInvitation {
  id: string;
  projectId: string;
  role: string;
  invitedBy: string | null;
  expiresAt: string;
}

export const dynamic = 'force-dynamic';

function formatNearBy(
  nearBy: { city: string | null; region: string | null; country: string | null } | null,
): string {
  if (!nearBy) return '—';
  const place = nearBy.city ?? nearBy.region;
  if (place && nearBy.country) return `${place}, ${nearBy.country}`;
  return place ?? nearBy.country ?? '—';
}

export default async function SettingsPage() {
  const user = await requireUser();

  const { invitations } = await apiJson<{ invitations: PendingInvitation[] }>(
    '/v1/me/invitations',
  ).catch(() => ({ invitations: [] as PendingInvitation[] }));

  async function save(
    patch: Record<string, string | null>,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    'use server';
    const res = await apiFetch('/v1/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      // Never throw from a server action on an expected user-visible error
      // (VAT-locked, VAT-invalid, validation). Throwing crosses the RSC
      // boundary and Next.js renders its generic error boundary instead
      // of the form's inline error. Return a result object so the client
      // can render the message cleanly.
      const body = await res.text().catch(() => '');
      let message = body;
      try {
        const parsed = JSON.parse(body) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        // body wasn't JSON — fall back to the raw text
      }
      return { ok: false, error: message || `update failed: ${res.status}` };
    }
    revalidatePath('/dashboard/settings');
    return { ok: true };
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8 pb-12">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text)]">Settings</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Account and notification preferences.
        </p>
      </header>

      <section className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Account</h2>
        <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              Email
            </span>
            <span className="text-sm text-[var(--color-text)]">
              {user.email}
              {user.emailVerified ? (
                <span className="ml-2 rounded bg-[var(--color-primary-subtle)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-primary)]">
                  verified
                </span>
              ) : (
                <span className="ml-2 rounded bg-red-400/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-red-400">
                  unverified
                </span>
              )}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              Name
            </span>
            <span className="text-sm text-[var(--color-text)]">
              {user.legalName ?? user.name ?? '—'}
            </span>
          </div>
        </div>
        <p className="mt-4 text-xs text-[var(--color-text-muted)]">
          Email is used for sign-in and alerts. To change it, click below — we&apos;ll send a
          confirmation link to your current address.
        </p>
        <ChangeEmailForm
          currentEmail={user.email}
          apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
        />
        {user.isAdmin ? (
          <p className="mt-3 text-xs">
            <span className="rounded bg-[var(--color-primary-subtle)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-primary)]">
              Platform admin
            </span>
            <Link
              href="/dashboard/admin"
              className="ml-3 text-[var(--color-text-link)] hover:underline"
            >
              open admin →
            </Link>
          </p>
        ) : null}
      </section>

      <section>
        <ProfileBillingForm
          initial={{
            name: user.name ?? '',
            legalName: user.legalName ?? '',
            companyName: user.companyName ?? '',
            companyRegistrationNumber: user.companyRegistrationNumber ?? '',
            vatId: user.vatId ?? '',
            addressLine1: user.addressLine1 ?? '',
            addressLine2: user.addressLine2 ?? '',
            addressCity: user.addressCity ?? '',
            addressPostalCode: user.addressPostalCode ?? '',
            addressRegion: user.addressRegion ?? '',
            addressCountry: user.addressCountry ?? '',
            dateOfBirth: user.dateOfBirth ?? '',
            countryOfBirth: user.countryOfBirth ?? '',
            timezone: user.timezone ?? '',
          }}
          currentImage={user.image}
          displayName={user.legalName ?? user.name ?? user.email}
          vatLocked={Boolean(user.vatVerifiedAt && user.vatId)}
          save={save}
        />
      </section>

      <section>
        <h2 className="font-mono text-sm text-[var(--color-text)]">last sign-in</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          under EU GDPR you have the right to see the metadata we store about your sign-in activity.
          visible only to you.
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-x-3 sm:grid-cols-[160px_1fr] gap-y-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 font-mono text-sm">
          <dt className="text-[var(--color-text-subtle)]">at</dt>
          <dd>
            {user.lastSignIn
              ? new Date(user.lastSignIn.at).toISOString().replace('T', ' ').slice(0, 19)
              : 'never'}
          </dd>

          <dt className="text-[var(--color-text-subtle)]">near by</dt>
          <dd>{formatNearBy(user.lastSignIn?.nearBy ?? null)}</dd>

          <dt className="text-[var(--color-text-subtle)]">ip address</dt>
          <dd>{user.lastSignIn?.ipAddress ?? '—'}</dd>

          <dt className="text-[var(--color-text-subtle)]">user agent</dt>
          <dd className="break-words text-xs text-[var(--color-text-muted)]">
            {user.lastSignIn?.userAgent ?? '—'}
          </dd>
        </dl>
      </section>

      <section>
        <h2 className="font-mono text-sm text-[var(--color-text)]">pending invitations</h2>
        {invitations.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-[var(--color-border)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
            no pending invitations.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 font-mono text-sm"
              >
                <div>
                  <p>
                    invited to <code>{inv.projectId}</code> as{' '}
                    <span className="text-[var(--color-primary)]">{inv.role}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                    expires {new Date(inv.expiresAt).toISOString().slice(0, 10)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-mono text-sm text-red-400">danger zone</h2>
        <DeleteAccountForm email={user.email} />
      </section>
    </div>
  );
}
