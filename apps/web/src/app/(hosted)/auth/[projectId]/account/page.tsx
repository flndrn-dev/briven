import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { PasskeyRegister } from '../passkey-register';
import { SignOutButton } from './sign-out-button';

interface SessionResponse {
  user?: {
    id?: string;
    email?: string;
    name?: string | null;
    emailVerified?: boolean | string | null;
  };
  session?: { expiresAt?: string };
}

const INTERNAL_API_ORIGIN = process.env.BRIVEN_API_INTERNAL_URL ?? 'http://localhost:3001';

export const metadata = { title: 'auth · account' };
export const dynamic = 'force-dynamic';

/**
 * Hosted-pages account screen. Server-side fetches the session by
 * forwarding the browser cookie to `/v1/auth-tenant/get-session`. Falls
 * back to `/sign-in` when there is no session. Hard-redacts the email to
 * a domain hint per CLAUDE.md §5.1 — even the account holder sees only
 * the domain on this screen, mirroring the dashboard convention.
 */
export default async function HostedAccountPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  let body: SessionResponse | null = null;
  try {
    const res = await fetch(`${INTERNAL_API_ORIGIN}/v1/auth-tenant/get-session`, {
      method: 'GET',
      headers: {
        cookie: cookieHeader,
        'x-briven-project-id': projectId,
      },
      cache: 'no-store',
    });
    if (res.ok) body = (await res.json()) as SessionResponse;
  } catch {
    body = null;
  }

  const user = body?.user;
  if (!user?.id) {
    redirect(`/auth/${projectId}/sign-in`);
  }

  const domain = user.email?.split('@')[1] ?? 'unknown';
  const initial = user.name ? Array.from(user.name)[0] ?? null : null;

  return (
    <article className="flex flex-col gap-5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <header>
        <h1 className="font-mono text-base text-[var(--color-text)]">account</h1>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          signed in
        </p>
      </header>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        <dt className="text-[var(--color-text-muted)]">id</dt>
        <dd className="text-[var(--color-text)]">
          <code title={user.id}>{user.id}</code>
        </dd>
        <dt className="text-[var(--color-text-muted)]">domain</dt>
        <dd className="text-[var(--color-text)]">
          <span className="text-[var(--color-text-muted)]">•••@</span>
          {domain}
        </dd>
        <dt className="text-[var(--color-text-muted)]">name</dt>
        <dd className="text-[var(--color-text)]">
          {initial ? `${initial}•••` : '—'}
        </dd>
        <dt className="text-[var(--color-text-muted)]">verified</dt>
        <dd className="text-[var(--color-text)]">
          {user.emailVerified ? 'yes' : 'no'}
        </dd>
        {body?.session?.expiresAt ? (
          <>
            <dt className="text-[var(--color-text-muted)]">expires</dt>
            <dd className="text-[var(--color-text)]">
              {body.session.expiresAt.slice(0, 16).replace('T', ' ')} utc
            </dd>
          </>
        ) : null}
      </dl>

      <PasskeyRegister projectId={projectId} />

      <SignOutButton projectId={projectId} />
    </article>
  );
}
