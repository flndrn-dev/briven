import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../lib/api';
import { AcceptButton } from './accept-button';

interface PendingInvitation {
  id: string;
  projectId: string;
  projectName: string;
  role: string;
  invitedBy: string | null;
  expiresAt: string;
}

export const metadata = { title: 'invitations' };
export const dynamic = 'force-dynamic';

export default async function InvitationsPage() {
  const data = await apiJson<{ invitations: PendingInvitation[] }>('/v1/me/invitations').catch(() => ({ invitations: [] as PendingInvitation[] }));
  const invitations = data.invitations;

  async function accept(invitationId: string): Promise<void> {
    'use server';
    const res = await apiFetch(`/v1/me/invitations/${invitationId}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? `accept failed: ${res.status}`);
    }
    const result = (await res.json()) as { projectId: string };
    revalidatePath('/dashboard/invitations');
    redirect(`/dashboard/projects/${result.projectId}`);
  }

  return (
    <section>
      <header className="mb-8">
        <h1 className="font-mono text-xl tracking-tight">invitations</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          {invitations.length === 0
            ? 'no pending invitations.'
            : `${invitations.length} pending invitation${invitations.length === 1 ? '' : 's'}`}
        </p>
      </header>

      {invitations.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-10 text-center">
          <p className="font-mono text-sm text-[var(--color-text-muted)]">
            project owners can invite you by email. when one does, the invitation will appear here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {invitations.map((invite) => {
            const expires = new Date(invite.expiresAt);
            const expiresIn = Math.max(
              0,
              Math.ceil((expires.getTime() - Date.now()) / 86_400_000),
            );
            return (
              <li
                key={invite.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
              >
                <div>
                  <p className="font-mono text-sm">{invite.projectName}</p>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                    role: {invite.role} · expires in {expiresIn} day{expiresIn === 1 ? '' : 's'}
                  </p>
                </div>
                <AcceptButton invitationId={invite.id} action={accept} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
