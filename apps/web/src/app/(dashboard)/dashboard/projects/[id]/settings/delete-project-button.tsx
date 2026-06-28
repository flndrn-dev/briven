'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  projectId: string;
  projectName: string;
  apiOrigin: string;
  /**
   * Whether the account has a delete secret. Without one the user can't
   * satisfy the step-up prompt, so instead of a dead input we point them
   * to Settings → Security to set one first.
   */
  hasDeleteSecret: boolean;
}

/**
 * Soft-deletes the project (api soft-delete kicks off a 30-day hard-
 * delete grace window per services/account-deletion + cron). Gated by
 * requireRecentMfa(10) on the api side; if the step-up window has
 * elapsed, we surface a delete-secret prompt inline.
 */
export function DeleteProjectButton({ projectId, projectName, apiOrigin, hasDeleteSecret }: Props) {
  const router = useRouter();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needStepUp, setNeedStepUp] = useState(false);

  // Inline delete-secret step-up state.
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [stepUpError, setStepUpError] = useState<string | null>(null);

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

  async function verifySecret() {
    if (secret.length === 0) return;
    setVerifying(true);
    setStepUpError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/me/delete-secret/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      });
      if (res.status === 401) {
        setStepUpError('secret incorrect');
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setStepUpError(text || `verify failed: ${res.status}`);
        return;
      }
      // MFA window is now fresh — retry the gated delete.
      setNeedStepUp(false);
      setSecret('');
      await performDelete();
    } catch (err) {
      setStepUpError(err instanceof Error ? err.message : 'verify failed');
    } finally {
      setVerifying(false);
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
        {needStepUp && hasDeleteSecret ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="confirm with delete secret"
            className="mt-1 flex flex-col gap-3 rounded-md border border-[var(--color-warning)] bg-[var(--color-surface)] p-3 font-mono text-[10px]"
          >
            <p className="text-[var(--color-text-muted)]">
              you&apos;re about to delete the project &quot;{projectName}&quot;. this triggers the
              30-day hard-delete grace window. paste your delete secret to confirm.
            </p>
            <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1">
              <input
                autoFocus
                type={showSecret ? 'text' : 'password'}
                autoComplete="off"
                placeholder="paste your delete secret"
                value={secret}
                onChange={(e) => setSecret(e.currentTarget.value)}
                disabled={verifying}
                className="min-w-0 flex-1 bg-transparent text-xs text-[var(--color-text)] outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowSecret((s) => !s)}
                aria-label={showSecret ? 'hide' : 'show'}
                title={showSecret ? 'hide' : 'show'}
                className="text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)] transition hover:text-[var(--color-text)]"
              >
                {showSecret ? 'hide' : 'show'}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={verifySecret}
                disabled={verifying || secret.length === 0}
                className="inline-flex h-8 items-center justify-center rounded-md bg-red-400 px-3 font-sans text-xs font-medium text-[var(--color-bg)] disabled:opacity-50"
              >
                {verifying ? 'verifying…' : 'confirm delete'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNeedStepUp(false);
                  setSecret('');
                  setStepUpError(null);
                }}
                disabled={verifying}
                className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                cancel
              </button>
              {stepUpError ? (
                <span className="text-[10px] text-[var(--color-error)]">{stepUpError}</span>
              ) : null}
            </div>
          </div>
        ) : null}
        {needStepUp && !hasDeleteSecret ? (
          <div className="mt-1 flex flex-col gap-2 rounded-md border border-[var(--color-warning)] bg-[var(--color-surface)] p-3 font-mono text-[10px] text-[var(--color-text-muted)]">
            <p>
              You need a delete secret to confirm this.{' '}
              <Link href="/dashboard/settings" className="text-[var(--color-text-link)] underline">
                Set one in Settings → Security
              </Link>
              .
            </p>
            <button
              type="button"
              onClick={() => setNeedStepUp(false)}
              className="self-start text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              cancel
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
