'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { StepUpPrompt } from '../../../../../../components/step-up-prompt';

interface Props {
  projectId: string;
  projectName: string;
  apiOrigin: string;
}

/**
 * Soft-deletes the project (api soft-delete kicks off a 30-day hard-
 * delete grace window per services/account-deletion + cron). Gated by
 * requireRecentMfa(10) on the api side; if the step-up window has
 * elapsed, we surface a password prompt inline.
 */
export function DeleteProjectButton({ projectId, projectName, apiOrigin }: Props) {
  const router = useRouter();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needStepUp, setNeedStepUp] = useState(false);

  const matches = confirm === projectName;

  async function performDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/projects/${projectId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        router.push('/dashboard/projects');
        return;
      }
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setNeedStepUp(true);
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

  return (
    <details className="font-mono text-xs">
      <summary className="cursor-pointer rounded-md border border-red-400 px-3 py-2 text-red-400">
        delete
      </summary>
      <div className="mt-3 flex flex-col gap-2">
        <p className="text-[var(--color-text-muted)]">
          type <span className="text-[var(--color-text)]">{projectName}</span> to confirm:
        </p>
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.currentTarget.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs"
        />
        <button
          type="button"
          disabled={!matches || busy || needStepUp}
          onClick={performDelete}
          className="rounded-md bg-red-400 px-3 py-2 font-mono text-xs font-medium text-[var(--color-bg)] disabled:opacity-30"
        >
          {busy ? 'deleting...' : 'permanently delete'}
        </button>
        {error ? (
          <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p>
        ) : null}
        {needStepUp ? (
          <StepUpPrompt
            apiOrigin={apiOrigin}
            reason={`you're about to delete the project "${projectName}". this triggers the 30-day hard-delete grace window.`}
            onSuccess={async () => {
              setNeedStepUp(false);
              await performDelete();
            }}
            onCancel={() => setNeedStepUp(false)}
          />
        ) : null}
      </div>
    </details>
  );
}
