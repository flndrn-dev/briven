import { revalidatePath } from 'next/cache';
import Link from 'next/link';

import { apiFetch, apiJson } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';
import { ProfileForm } from './profile-form';

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

  async function save(patch: Record<string, string | null>) {
    'use server';
    const res = await apiFetch('/v1/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `update failed: ${res.status}`);
    }
    revalidatePath('/dashboard/settings');
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8 pb-12">
      <section>
        <h2 className="font-mono text-sm text-[var(--color-text)]">account</h2>
        <dl className="mt-3 grid grid-cols-[160px_1fr] gap-y-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 font-mono text-sm">
          <dt className="text-[var(--color-text-subtle)]">email</dt>
          <dd>
            {user.email}
            {user.emailVerified ? (
              <span className="ml-2 rounded bg-[var(--color-primary-subtle)] px-1.5 py-0.5 text-xs text-[var(--color-primary)]">
                verified
              </span>
            ) : (
              <span className="ml-2 rounded bg-red-400/15 px-1.5 py-0.5 text-xs text-red-400">
                unverified
              </span>
            )}
          </dd>

          <dt className="text-[var(--color-text-subtle)]">user id</dt>
          <dd className="truncate text-xs">{user.id}</dd>

          <dt className="text-[var(--color-text-subtle)]">joined</dt>
          <dd>{new Date(user.createdAt).toISOString().slice(0, 10)}</dd>

          {user.isAdmin ? (
            <>
              <dt className="text-[var(--color-text-subtle)]">role</dt>
              <dd>
                <span className="rounded bg-[var(--color-primary-subtle)] px-2 py-0.5 text-xs text-[var(--color-primary)]">
                  platform admin
                </span>
                <Link
                  href="/dashboard/admin"
                  className="ml-3 text-[var(--color-text-link)] hover:underline"
                >
                  open admin →
                </Link>
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      <section>
        <h2 className="font-mono text-sm text-[var(--color-text)]">profile + billing (EU KYC)</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          required before a paid plan checkout. used for VAT determination, invoice issuance, and
          EU KYC compliance. stored only on the control plane, never shared with a customer
          project.
        </p>
        <div className="mt-3">
          <ProfileForm
            initial={{
              name: user.name ?? '',
              legalName: user.legalName ?? '',
              companyName: user.companyName ?? '',
              vatId: user.vatId ?? '',
              addressLine1: user.addressLine1 ?? '',
              addressLine2: user.addressLine2 ?? '',
              addressCity: user.addressCity ?? '',
              addressPostalCode: user.addressPostalCode ?? '',
              addressRegion: user.addressRegion ?? '',
              addressCountry: user.addressCountry ?? '',
            }}
            save={save}
          />
        </div>
      </section>

      <section>
        <h2 className="font-mono text-sm text-[var(--color-text)]">last sign-in</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          under EU GDPR you have the right to see the metadata we store about your sign-in
          activity. visible only to you.
        </p>
        <dl className="mt-3 grid grid-cols-[160px_1fr] gap-y-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 font-mono text-sm">
          <dt className="text-[var(--color-text-subtle)]">at</dt>
          <dd>
            {user.lastSignIn
              ? new Date(user.lastSignIn.at).toISOString().replace('T', ' ').slice(0, 19)
              : 'never'}
          </dd>

          <dt className="text-[var(--color-text-subtle)]">ip address</dt>
          <dd>{user.lastSignIn?.ipAddress ?? '—'}</dd>

          <dt className="text-[var(--color-text-subtle)]">near by</dt>
          <dd>{formatNearBy(user.lastSignIn?.nearBy ?? null)}</dd>

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
        <div className="mt-3 rounded-md border border-red-400/30 bg-red-400/5 p-5 font-mono text-sm">
          <p>
            account deletion arrives in phase 3. use <code>briven cli export</code> first.
          </p>
        </div>
      </section>
    </div>
  );
}
