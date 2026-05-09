'use client';

import { useState, useTransition } from 'react';

type Role = 'owner' | 'admin' | 'developer' | 'viewer';

interface Props {
  userId: string;
  role: Role;
  onUpdateRole: (userId: string, role: Role) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
}

const ASSIGNABLE: Role[] = ['admin', 'developer', 'viewer'];

export function MemberActions({ userId, role, onUpdateRole, onRemove }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (role === 'owner') {
    return <span className="font-mono text-xs text-[var(--color-text-muted)]">owner</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={role}
        disabled={pending}
        onChange={(e) => startTransition(() => onUpdateRole(userId, e.currentTarget.value as Role))}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 font-mono text-xs"
      >
        {ASSIGNABLE.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {confirming ? (
        <>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="font-mono text-xs text-[var(--color-text-muted)]"
          >
            cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => onRemove(userId))}
            className="rounded-md border border-red-400 px-2 py-1 font-mono text-xs text-red-400 disabled:opacity-50"
          >
            {pending ? 'removing...' : 'confirm remove'}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-xs text-[var(--color-text-muted)] hover:border-red-400 hover:text-red-400"
        >
          remove
        </button>
      )}
    </div>
  );
}
