'use client';

import { useTransition } from 'react';

interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

interface Props {
  invitation: Invitation;
  onRevoke: (invitationId: string) => Promise<void>;
}

export function InvitationRow({ invitation, onRevoke }: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <li className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-2">
      <div>
        <p className="font-mono text-sm">
          {invitation.email}{' '}
          <span className="text-[var(--color-text-subtle)]">· pending · {invitation.role}</span>
        </p>
        <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
          expires {new Date(invitation.expiresAt).toISOString().slice(0, 10)}
        </p>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => onRevoke(invitation.id))}
        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-red-400 hover:text-red-400 disabled:opacity-50"
      >
        {pending ? 'revoking...' : 'revoke'}
      </button>
    </li>
  );
}
