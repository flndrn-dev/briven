'use client';

import { useTransition } from 'react';

interface AdminUser {
  id: string;
  isAdmin: boolean;
  suspendedAt: string | null;
}

interface Props {
  user: AdminUser;
  act: (action: string, userId: string) => Promise<void>;
}

export function UserActions({ user, act }: Props) {
  const [pending, startTransition] = useTransition();

  function run(action: string) {
    if (!confirm(`confirm ${action} for ${user.id}?`)) return;
    startTransition(() => act(action, user.id));
  }

  return (
    <div className="flex gap-2 font-mono text-xs">
      {user.suspendedAt ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run('unsuspend')}
          className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-primary)] disabled:opacity-50"
        >
          unsuspend
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run('suspend')}
          className="rounded-md border border-[var(--color-border)] px-2 py-1 text-red-400 disabled:opacity-50"
        >
          suspend
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => run('force-sign-out')}
        className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-text-muted)] disabled:opacity-50"
      >
        force sign-out
      </button>
      {user.isAdmin ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run('revoke-admin')}
          className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-text-muted)] disabled:opacity-50"
        >
          revoke admin
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run('grant-admin')}
          className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-primary)] disabled:opacity-50"
        >
          grant admin
        </button>
      )}
    </div>
  );
}
