'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  requestId: string;
}

interface ErrorBody {
  code?: string;
  message?: string;
}

/**
 * Compact trash-icon delete control for the migration request list row.
 * Two-click: icon arms a confirm pill; second click sends the DELETE.
 * Hard delete (api cascades audit-event rows).
 */
export function RowDeleteMigrationButton({ requestId }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/migration-requests/${requestId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorBody;
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        aria-label={`delete migration request ${requestId}`}
        title="delete migration request"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(true);
        }}
        className="rounded-md border border-transparent p-1.5 text-[var(--color-text-subtle)] transition hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
      >
        <TrashIcon />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-[var(--color-error)] bg-[var(--color-bg)] px-1.5 py-1">
      <span className="font-mono text-[10px] text-[var(--color-text)]">delete?</span>
      <button
        type="button"
        disabled={busy}
        onClick={del}
        className="rounded-md bg-[var(--color-error)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-inverse)] disabled:opacity-30"
      >
        {busy ? '…' : 'yes'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(false);
          setError(null);
        }}
        className="rounded-md border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        no
      </button>
      {error ? (
        <span className="font-mono text-[10px] text-[var(--color-error)]">{error}</span>
      ) : null}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
