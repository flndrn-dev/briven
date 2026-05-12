import { redirect } from 'next/navigation';

import { apiFetch } from '../../../../../lib/api';

export const metadata = { title: 'accept team invitation' };
export const dynamic = 'force-dynamic';

interface AcceptResult {
  accepted: boolean;
  orgId: string;
  role: string;
}

export default async function AcceptOrgInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 font-mono text-sm">
        <h1 className="text-xl">invitation token missing</h1>
        <p className="mt-2 text-[var(--color-text-muted)]">
          use the link from the team invitation email. if it&apos;s expired, ask the team owner to
          resend.
        </p>
      </main>
    );
  }

  const res = await apiFetch('/v1/org-invitations/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  if (res.status === 401) {
    redirect(
      `/signin?next=${encodeURIComponent(`/dashboard/org-invitations/accept?token=${token}`)}`,
    );
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    return (
      <main className="mx-auto max-w-lg px-6 py-16 font-mono text-sm">
        <h1 className="text-xl">couldn&apos;t accept this team invitation</h1>
        <p className="mt-2 text-[var(--color-text-muted)]">
          {body.message ?? `http ${res.status}`}
        </p>
        <p className="mt-6">
          <a href="/dashboard" className="text-[var(--color-text-link)]">
            back to dashboard
          </a>
        </p>
      </main>
    );
  }

  const result = (await res.json()) as AcceptResult;
  redirect(`/dashboard/teams/${result.orgId}`);
}
