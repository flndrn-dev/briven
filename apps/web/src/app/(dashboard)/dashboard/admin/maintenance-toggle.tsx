'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  initial: boolean;
  apiOrigin: string;
}

/**
 * Maintenance-mode toggle. Two-step confirm — entering maintenance
 * mode returns 503 across the customer-facing surface, so a stray
 * click would cause an outage. Exit prompt is also two-step for
 * symmetry. Status pill is amber-or-red to match the severity of
 * "you are about to take the platform down."
 */
export function MaintenanceToggle({ initial, apiOrigin }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [phase, setPhase] = useState<'idle' | 'confirming' | 'flipping'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function flip(next: boolean) {
    setPhase('flipping');
    setError(null);
    try {
      const res = await fetch(
        `${apiOrigin}/v1/admin/launch-status/maintenance-mode`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ maintenanceMode: next }),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `flip failed: ${res.status}`);
      }
      setEnabled(next);
      setPhase('idle');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'flip failed');
      setPhase('idle');
    }
  }

  const stateTone = enabled
    ? 'border-[var(--color-error)] text-[var(--color-error)]'
    : 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]';

  return (
    <li className="flex flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          maintenance mode
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${stateTone}`}
        >
          {enabled ? 'live · 503 to customers' : 'off'}
        </span>
      </div>

      <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
        {enabled
          ? 'every non-admin route is returning 503. /v1/auth, /v1/me, /v1/admin, /health, /ready stay open so you can flip back.'
          : "flips every non-admin route to 503 — emergency-only. customer functions won't run, the dashboard project pages 503, but auth + admin still work."}
      </p>

      {phase === 'confirming' ? (
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-[10px] ${enabled ? 'text-[var(--color-primary)]' : 'text-[var(--color-error)]'}`}
          >
            {enabled
              ? 'flip out of maintenance? customer traffic resumes immediately.'
              : 'put the platform into maintenance? this returns 503 across the customer-facing surface.'}
          </span>
          <button
            type="button"
            disabled={phase !== 'confirming'}
            onClick={() => flip(!enabled)}
            className={`rounded-md border px-2 py-1 font-mono text-[10px] ${enabled ? 'border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-[var(--color-text-inverse)]' : 'border-[var(--color-error)] text-[var(--color-error)] hover:bg-[var(--color-error)] hover:text-[var(--color-text-inverse)]'} disabled:opacity-50`}
          >
            confirm
          </button>
          <button
            type="button"
            onClick={() => setPhase('idle')}
            className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={phase === 'flipping'}
          onClick={() => setPhase('confirming')}
          className={`self-start rounded-md border px-3 py-1.5 font-mono text-xs disabled:opacity-50 ${enabled ? 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]' : 'border-[var(--color-error)] text-[var(--color-error)] hover:bg-[var(--color-error)] hover:text-[var(--color-text-inverse)]'}`}
        >
          {phase === 'flipping' ? 'flipping…' : enabled ? 'exit maintenance' : 'enter maintenance'}
        </button>
      )}

      {error ? (
        <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p>
      ) : null}
    </li>
  );
}
