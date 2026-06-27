'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '../../../../../components/step-up-prompt';

type Enforcement = 'flag' | 'block';

interface Props {
  apiOrigin: string;
  projectId: string;
  projectName: string;
  /** Current enforcement mode for this project. */
  enforcement: Enforcement;
}

/**
 * Per-project enforcement toggle (flag ⇄ block). PATCHes
 * /v1/admin/storage/projects/:id/enforcement with the OTHER mode, then
 * refreshes the list. 'flag' (default) only surfaces over-limit in the
 * dashboard and never blocks; 'block' rejects new createTable / insertRow
 * once the project is over its effective cap. Step-up gated exactly like the
 * limit editor — a 403 step_up_required surfaces the inline password prompt
 * and we retry the same flip.
 */
export function EnforcementForm({ apiOrigin, projectId, projectName, enforcement }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Enforcement | null>(null);
  const [, startTransition] = useTransition();

  const isBlock = enforcement === 'block';
  const next: Enforcement = isBlock ? 'flag' : 'block';

  async function send(mode: Enforcement) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiOrigin}/v1/admin/storage/projects/${encodeURIComponent(projectId)}/enforcement`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enforcement: mode }),
        },
      );
      if (res.status === 403) {
        const parsed = (await res.json().catch(() => null)) as { code?: string } | null;
        if (parsed?.code === 'step_up_required') {
          setPending(mode);
          return;
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `save failed: ${res.status}`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span
          className={
            isBlock
              ? 'inline-flex rounded-md bg-[var(--color-error)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-error)]'
              : 'inline-flex rounded-md bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]'
          }
        >
          {isBlock ? 'block' : 'flag'}
        </span>
        <button
          type="button"
          onClick={() => void send(next)}
          disabled={busy}
          title={
            isBlock
              ? 'block: rejects new rows/tables over the cap. switch to flag to only surface over-limit.'
              : 'flag: shows over-limit, never blocks. switch to block to reject new rows/tables over the cap.'
          }
          className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
        >
          {busy ? 'saving…' : isBlock ? 'switch to flag' : 'switch to block'}
        </button>
      </div>
      <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
        {isBlock
          ? 'block: rejects new rows/tables over the cap.'
          : 'flag: shows over-limit, never blocks.'}
      </p>
      {error ? (
        <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p>
      ) : null}
      {pending != null ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason={`changing enforcement for ${projectName} requires fresh step-up auth.`}
          onSuccess={async () => {
            const mode = pending;
            setPending(null);
            await send(mode);
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
