'use client';

import { useState, useTransition } from 'react';

interface Props {
  keyId: string;
  onRevoke: (keyId: string) => Promise<void>;
}

export function RevokeButton({ keyId, onRevoke }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
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
          onClick={() => startTransition(() => onRevoke(keyId))}
          className="rounded-md border border-red-400 px-3 py-1.5 font-mono text-xs text-red-400 disabled:opacity-50"
        >
          {pending ? 'revoking...' : 'confirm revoke'}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-red-400 hover:text-red-400"
    >
      revoke
    </button>
  );
}
