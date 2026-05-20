'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  projectId: string;
  projectName: string;
  apiOrigin: string;
}

interface ErrorBody {
  code?: string;
  message?: string;
}

/**
 * Compact trash-icon delete control for the projects list row.
 * Two-step: icon click arms a typed-name confirm; second click sends the
 * DELETE. If the api returns step_up_required, we route to the project's
 * settings page where the full step-up prompt lives — keeps this row-level
 * control small while still allowing the destructive path to complete.
 */
export function RowDeleteProjectButton({ projectId, projectName, apiOrigin }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = confirm === projectName;

  async function performDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/projects/${projectId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as ErrorBody | null;
        if (body?.code === 'step_up_required') {
          router.push(`/dashboard/projects/${projectId}/settings#delete`);
          return;
        }
      }
      const text = await res.text().catch(() => '');
      throw new Error(text || `delete failed: ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label={`delete ${projectName}`}
        title="delete project"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="rounded-md border border-transparent p-1.5 text-[var(--color-text-subtle)] transition hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
      >
        <TrashIcon />
      </button>
    );
  }

  return (
    <div
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="flex flex-col gap-2 rounded-md border border-[var(--color-error)] bg-[var(--color-bg)] p-2 text-left"
    >
      <p className="font-mono text-[10px] text-[var(--color-text)]">
        type <span className="text-[var(--color-error)]">{projectName}</span> to confirm:
      </p>
      <input
        value={confirm}
        autoFocus
        onChange={(e) => setConfirm(e.currentTarget.value)}
        onClick={(e) => e.stopPropagation()}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!matches || busy}
          onClick={performDelete}
          className="rounded-md bg-[var(--color-error)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-inverse)] disabled:opacity-30"
        >
          {busy ? 'deleting…' : 'delete'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setConfirm('');
            setError(null);
          }}
          className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          cancel
        </button>
      </div>
      {error ? (
        <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p>
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
