'use client';

import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';

import { StepUpPrompt } from '@/components/step-up-prompt';

interface LaunchStatusLite {
  stepUpFresh: boolean;
  stepUpExpiresAt: string | null;
}

/**
 * Step-up freshness card. Admin mutations (kill-switches, key issuing,
 * maintenance mode…) require a password re-entry inside a 10-minute window
 * — this card shows whether that window is currently open, and lets the
 * operator re-attest ahead of time so the next mutation doesn't interrupt
 * them with a prompt.
 *
 * Polls the existing /v1/admin/launch-status endpoint (which carries
 * stepUpFresh + stepUpExpiresAt) every 30s — same source of truth the old
 * dashboard admin pill used. Honest states only: fresh, expired, or
 * "couldn't reach the api".
 */
export function StepUpCard({ apiOrigin }: { apiOrigin: string }) {
  const [status, setStatus] = useState<LaunchStatusLite | null>(null);
  const [failed, setFailed] = useState(false);
  const [prompting, setPrompting] = useState(false);
  // Ticks each poll so minutes-left re-derives even without new data.
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/launch-status`, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`launch-status failed: ${res.status}`);
      const json = (await res.json()) as LaunchStatusLite;
      setStatus(json);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setNow(Date.now());
    }
  }, [apiOrigin]);

  useEffect(() => {
    void refresh();
    const handle = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    return () => clearInterval(handle);
  }, [refresh]);

  const minutesLeft =
    status?.stepUpExpiresAt != null
      ? Math.max(0, Math.floor((new Date(status.stepUpExpiresAt).getTime() - now) / 60_000))
      : null;
  const fresh = Boolean(status?.stepUpFresh && minutesLeft !== null && minutesLeft > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex flex-col gap-6 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 sm:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-start gap-5">
          <span className="mt-2.5">
            <PulseDot fresh={fresh} unknown={status === null} />
          </span>
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              step-up auth
            </span>
            <span
              className={`font-mono text-3xl tracking-tight ${
                status === null
                  ? 'text-[var(--color-text-subtle)]'
                  : fresh
                    ? 'text-[var(--color-success)]'
                    : 'text-[var(--color-warning)]'
              }`}
            >
              {status === null
                ? failed
                  ? '—'
                  : 'checking…'
                : fresh
                  ? `fresh · ${minutesLeft}m left`
                  : 'expired'}
            </span>
            <span className="max-w-prose font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
              {status === null && failed
                ? "couldn't reach the api to check — the state shows as soon as it answers."
                : 'sensitive admin actions (kill-switches, key issuing, maintenance mode) ask for your password again and stay unlocked for 10 minutes. re-attest here to open that window before you start flipping switches.'}
            </span>
          </div>
        </div>

        {!prompting && status !== null && !fresh ? (
          <button
            type="button"
            onClick={() => setPrompting(true)}
            className="rounded-md border border-[var(--color-warning)] px-5 py-2.5 font-mono text-xs text-[var(--color-warning)] transition hover:bg-[var(--color-warning)] hover:text-[var(--color-text-inverse)]"
          >
            re-attest now
          </button>
        ) : null}
      </div>

      {prompting ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason="re-attesting opens the 10-minute window during which sensitive admin actions run without extra prompts."
          onSuccess={async () => {
            setPrompting(false);
            await refresh();
          }}
          onCancel={() => setPrompting(false)}
        />
      ) : null}
    </motion.div>
  );
}

/** Green pulse while fresh, static amber when expired, muted while unknown. */
function PulseDot({ fresh, unknown }: { fresh: boolean; unknown: boolean }) {
  const color = unknown
    ? 'bg-[var(--color-text-subtle)]'
    : fresh
      ? 'bg-[var(--color-success)]'
      : 'bg-[var(--color-warning)]';
  return (
    <span className="relative flex h-3.5 w-3.5 shrink-0" aria-hidden>
      {fresh ? (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${color}`}
        />
      ) : null}
      <span className={`relative inline-flex h-3.5 w-3.5 rounded-full ${color}`} />
    </span>
  );
}
