'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  apiOrigin: string;
}

/**
 * Per-file admin recover control. POSTs
 * /v1/admin/storage/projects/:id/files/:fileId/restore to un-delete a single
 * soft-deleted file — the support path for "a customer emailed asking to
 * restore file X". Takes a project id + file id by hand (the operator pastes
 * them from the customer's message), shows the returned status on success and
 * the error message on failure.
 */
export function RecoverFileForm({ apiOrigin }: Props) {
  const router = useRouter();
  const [projectId, setProjectId] = useState('');
  const [fileId, setFileId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function send() {
    const pid = projectId.trim();
    const fid = fileId.trim();
    if (pid === '' || fid === '') {
      setError('project id and file id are both required');
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(
        `${apiOrigin}/v1/admin/storage/projects/${encodeURIComponent(pid)}/files/${encodeURIComponent(fid)}/restore`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
        },
      );
      if (!res.ok) {
        const parsed = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(parsed?.message || `recover failed: ${res.status}`);
      }
      const parsed = (await res.json().catch(() => null)) as { status?: string } | null;
      setStatus(parsed?.status ?? 'restored');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'recover failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] text-[var(--color-text-muted)]">project id</span>
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="prj_…"
            disabled={busy}
            className="w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] text-[var(--color-text-muted)]">file id</span>
          <input
            type="text"
            value={fileId}
            onChange={(e) => setFileId(e.target.value)}
            placeholder="file_…"
            disabled={busy}
            className="w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy}
          className="rounded-md border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] px-3 py-1 font-mono text-xs text-[var(--color-primary)] hover:bg-[var(--color-primary)]/15 disabled:opacity-50"
        >
          {busy ? 'recovering…' : 'recover'}
        </button>
      </div>
      {status ? (
        <p className="font-mono text-[10px] text-[var(--color-primary)]">recovered · {status}</p>
      ) : null}
      {error ? (
        <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p>
      ) : null}
    </div>
  );
}
