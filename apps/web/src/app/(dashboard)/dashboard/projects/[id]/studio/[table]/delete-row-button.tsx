'use client';

import { useState } from 'react';

interface Props {
  /**
   * Row-identity payload. Length-1 for single-PK tables, length-N for
   * composite. The api validates the column set against the table's
   * actual primary key on every request.
   */
  primaryKey: Array<{ column: string; value: string | number }>;
  action: (input: {
    primaryKey: Array<{ column: string; value: string | number }>;
  }) => Promise<void>;
}

/**
 * Delete-row button. Click once → confirm prompt; click again within
 * 4 seconds to commit. Reverts to the unconfirmed state on any other
 * interaction. Keeps the destructive operation behind a deliberate
 * second click without modal infrastructure.
 */
export function DeleteRowButton({ primaryKey, action }: Props) {
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
      await action({ primaryKey });
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
            ? 'bg-[var(--color-error)] text-[var(--color-text-inverse)] ring-1 ring-[var(--color-error)]'
            : 'border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
        } ${pending ? 'opacity-60' : ''}`}
      >
        {pending ? '…' : confirming ? 'confirm delete?' : 'delete'}
      </button>
      {confirming && !pending ? (
        <span className="font-mono text-[10px] font-semibold text-[var(--color-error)]">
          click again to delete
        </span>
      ) : null}
      {error ? (
        <span className="font-mono text-[10px] text-[var(--color-error)]" title={error}>
          {error.slice(0, 60)}
        </span>
      ) : null}
    </div>
  );
}
