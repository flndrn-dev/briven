'use client';

import { useState } from 'react';

interface Props {
  apiOrigin: string;
  /** Copy describing what action will run after a successful step-up. */
  reason: string;
  /** Called after /v1/me/step-up returns 200 — the caller retries the gated action here. */
  onSuccess: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Re-auth prompt for actions gated by `requireRecentMfa` on the api.
 *
 * Flow: user clicks a destructive button → API returns 403 with
 * code='step_up_required' → caller mounts this component → user types
 * their password → POST /v1/me/step-up bumps users.last_mfa_at → on
 * success, caller's onSuccess re-runs the original action which the
 * api now accepts.
 *
 * Keep this dialog-shaped (not a separate route): the action context
 * stays in view, and the caller doesn't have to thread state through
 * navigation. The api enforces the actual security; this is just the
 * affordance that lets the user complete it.
 */
export function StepUpPrompt({ apiOrigin, reason, onSuccess, onCancel }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/me/step-up`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        setError('password incorrect');
        return;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `step-up failed: ${res.status}`);
      }
      // Auth bumped; let the caller retry. The caller decides whether
      // to clear our state or unmount us — we don't navigate ourselves.
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'step-up failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="confirm with password"
      className="mt-3 flex flex-col gap-3 rounded-md border border-[var(--color-warning)] bg-[var(--color-surface)] p-4 font-mono text-xs"
    >
      <p className="text-[var(--color-text)]">
        confirm with your password to continue.
      </p>
      <p className="text-[var(--color-text-muted)]">{reason}</p>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <input
          autoFocus
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={1}
          disabled={busy}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={busy || password.length === 0}
            className="inline-flex h-8 items-center justify-center rounded-md bg-[var(--color-primary)] px-3 font-sans text-xs text-[var(--color-text-inverse)] disabled:opacity-50"
          >
            {busy ? 'verifying…' : 'confirm'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            cancel
          </button>
          {error ? (
            <span className="font-mono text-[10px] text-[var(--color-error)]">{error}</span>
          ) : null}
        </div>
      </form>
      <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
        per CLAUDE.md §5.4, destructive actions require a fresh password attestation within 10
        minutes. you won&apos;t be re-prompted for the rest of that window.
      </p>
    </div>
  );
}
