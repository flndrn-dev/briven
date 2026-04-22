'use client';

import { useState, useTransition } from 'react';

interface Props {
  envVarId: string;
  envKey: string;
  onDelete: (envVarId: string) => Promise<void>;
}

export function DeleteEnvButton({ envVarId, envKey, onDelete }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-red-400 hover:text-red-400"
      >
        delete
      </button>
    );
  }

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
        onClick={() => startTransition(() => onDelete(envVarId))}
        className="rounded-md border border-red-400 px-3 py-1.5 font-mono text-xs text-red-400 disabled:opacity-50"
      >
        {pending ? 'deleting...' : `delete ${envKey}`}
      </button>
    </div>
  );
}
