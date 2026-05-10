'use client';

import { useState } from 'react';

interface Props {
  primaryKeyColumn: string;
  primaryKeyValue: string | number;
  action: (input: { primaryKeyColumn: string; primaryKeyValue: string | number }) => Promise<void>;
}

/**
 * Delete-row button. Click once → confirm prompt; click again within
 * 4 seconds to commit. Reverts to the unconfirmed state on any other
 * interaction. Keeps the destructive operation behind a deliberate
 * second click without modal infrastructure.
 */
export function DeleteRowButton({ primaryKeyColumn, primaryKeyValue, action }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!confirming) {
      setConfirming(true);
      setError(null);
      // Auto-cancel after 4s so a stray click doesn't leave the row in a
      // half-confirmed state.
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setPending(true);
    try {
      await action({ primaryKeyColumn, primaryKeyValue });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        title={confirming ? 'click again to confirm' : 'delete row'}
        className={`rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition ${
          confirming
            ? 'bg-[var(--color-text-error)] text-[var(--color-text-inverse)]'
            : 'border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
        } ${pending ? 'opacity-60' : ''}`}
      >
        {pending ? '…' : confirming ? 'confirm?' : 'delete'}
      </button>
      {error ? (
        <span className="font-mono text-[10px] text-[var(--color-text-error)]" title={error}>
          {error.slice(0, 60)}
        </span>
      ) : null}
    </div>
  );
}
