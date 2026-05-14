'use client';

import { useEffect, useState } from 'react';

import { StepUpPrompt } from '../../../../components/step-up-prompt';

interface Props {
  apiOrigin: string;
}

interface LaunchStatusLite {
  stepUpFresh: boolean;
  stepUpExpiresAt: string | null;
}

/**
 * Single source of truth for "is my admin step-up still fresh?" across
 * the admin pages. Polls /v1/admin/launch-status on a 30s interval and
 * exposes a one-click re-attest button.
 *
 * Sits in the admin layout so it's visible on every admin tab. When
 * step-up is fresh, the pill is a subtle green ticker; when it's
 * stale, the pill turns amber + the operator clicks "re-attest" → the
 * shared StepUpPrompt opens inline → on success, the next admin
 * mutation succeeds without per-button refactoring.
 */
export function AdminStepUpStatus({ apiOrigin }: Props) {
  const [status, setStatus] = useState<LaunchStatusLite | null>(null);
  const [prompting, setPrompting] = useState(false);

  async function refresh() {
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/launch-status`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const json = (await res.json()) as LaunchStatusLite;
      setStatus(json);
    } catch {
      // Ignore — the pill defaults to "unknown" tone below.
    }
  }

  useEffect(() => {
    void refresh();
    const handle = setInterval(refresh, 30_000);
    return () => clearInterval(handle);
  }, [apiOrigin]);

  if (!status) {
    return (
      <span className="rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        step-up · loading
      </span>
    );
  }

  if (prompting) {
    return (
      <div className="w-full max-w-md">
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason="admin mutations on briven require a fresh password attestation per CLAUDE.md §5.4. ten-minute window."
          onSuccess={async () => {
            setPrompting(false);
            await refresh();
          }}
          onCancel={() => setPrompting(false)}
        />
      </div>
    );
  }

  const minutesLeft = status.stepUpExpiresAt
    ? Math.max(0, Math.floor((new Date(status.stepUpExpiresAt).getTime() - Date.now()) / 60_000))
    : null;

  if (status.stepUpFresh && minutesLeft !== null && minutesLeft > 0) {
    return (
      <span
        className="rounded-full border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]"
        title={`re-attestation required after ${minutesLeft}m`}
      >
        step-up · {minutesLeft}m left
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPrompting(true)}
      className="rounded-full border border-[var(--color-warning)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-warning)] hover:bg-[var(--color-warning)] hover:text-[var(--color-text-inverse)]"
      title="step-up auth expired or never attested — re-attest to unlock admin mutations"
    >
      step-up · re-attest
    </button>
  );
}
