'use client';

import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '@/components/step-up-prompt';

/* ─── pulsing status dot ─────────────────────────────────────────────────── */

/**
 * Big clear on/off state for a hero control. `tone` picks the color of the
 * "active" state — maintenance being ON is red (customers see 503), signups
 * being OPEN is green (healthy growth state). Pulses only when active.
 */
function PulseDot({ active, activeColor }: { active: boolean; activeColor: 'red' | 'green' }) {
  const color = active
    ? activeColor === 'red'
      ? 'bg-[var(--color-error)]'
      : 'bg-[var(--color-success)]'
    : 'bg-[var(--color-text-subtle)]';
  return (
    <span className="relative flex h-3.5 w-3.5 shrink-0" aria-hidden>
      {active ? (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${color}`}
        />
      ) : null}
      <span className={`relative inline-flex h-3.5 w-3.5 rounded-full ${color}`} />
    </span>
  );
}

/* ─── shared hero-card shell ─────────────────────────────────────────────── */

function HeroCard({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex flex-col gap-6 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 sm:p-8"
    >
      {children}
    </motion.div>
  );
}

/* ─── maintenance mode (hero control) ────────────────────────────────────── */

/**
 * Maintenance-mode switch. Two-step confirm — entering maintenance mode
 * returns 503 across the customer-facing surface, so a stray click would
 * cause an outage. Posts to /v1/admin/launch-status/maintenance-mode and
 * retries through the shared StepUpPrompt when the api asks for fresh auth.
 */
export function MaintenanceControl({
  initial,
  apiOrigin,
}: {
  initial: boolean;
  apiOrigin: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [phase, setPhase] = useState<'idle' | 'confirming' | 'flipping'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [pendingFlip, setPendingFlip] = useState<boolean | null>(null);

  async function flip(next: boolean) {
    setPhase('flipping');
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/launch-status/maintenance-mode`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maintenanceMode: next }),
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPendingFlip(next);
          setPhase('idle');
          return;
        }
      }
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

  return (
    <HeroCard>
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-start gap-5">
          <span className="mt-2.5">
            <PulseDot active={enabled} activeColor="red" />
          </span>
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              maintenance mode
            </span>
            <span
              className={`font-mono text-3xl tracking-tight ${
                enabled ? 'text-[var(--color-error)]' : 'text-[var(--color-text)]'
              }`}
            >
              {enabled ? 'on · 503 to customers' : 'off'}
            </span>
            <span className="max-w-prose font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
              {enabled
                ? 'every non-admin route is returning 503 right now. /v1/auth, /v1/me, /v1/admin, /health and /ready stay open so you can flip back.'
                : 'the emergency brake. turning this on makes the whole platform answer "503 — down for maintenance" to customers. auth, health checks and this admin cockpit stay open so you can flip it back.'}
            </span>
          </div>
        </div>

        {phase !== 'confirming' ? (
          <button
            type="button"
            disabled={phase === 'flipping'}
            onClick={() => setPhase('confirming')}
            className={
              enabled
                ? 'rounded-md bg-[var(--color-primary)] px-5 py-2.5 font-mono text-xs text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50'
                : 'rounded-md border border-[var(--color-error)] px-5 py-2.5 font-mono text-xs text-[var(--color-error)] transition hover:bg-[var(--color-error)] hover:text-[var(--color-text-inverse)] disabled:opacity-50'
            }
          >
            {phase === 'flipping' ? 'flipping…' : enabled ? 'exit maintenance' : 'enter maintenance'}
          </button>
        ) : null}
      </div>

      {phase === 'confirming' ? (
        <div
          className={`flex flex-col gap-3 rounded-lg border p-4 font-mono text-xs ${
            enabled ? 'border-[var(--color-border)]' : 'border-[var(--color-error)]'
          }`}
        >
          <p className="text-[var(--color-text)]">
            {enabled
              ? 'flip out of maintenance? customer traffic resumes immediately.'
              : 'put the platform into maintenance? every customer-facing page and api call starts returning 503 the moment you confirm.'}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void flip(!enabled)}
              className={`rounded-md px-4 py-2 font-mono text-xs text-[var(--color-text-inverse)] ${
                enabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-error)]'
              }`}
            >
              {enabled ? 'yes, resume traffic' : 'yes, take it down'}
            </button>
            <button
              type="button"
              onClick={() => setPhase('idle')}
              className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p> : null}

      {pendingFlip !== null ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason={
            pendingFlip
              ? 'entering maintenance returns 503 across the customer-facing surface. confirm with your password.'
              : 'exiting maintenance resumes customer traffic. confirm with your password.'
          }
          onSuccess={async () => {
            const next = pendingFlip;
            setPendingFlip(null);
            if (next !== null) await flip(next);
          }}
          onCancel={() => setPendingFlip(null)}
        />
      ) : null}
    </HeroCard>
  );
}

/* ─── open signups (hero control) ────────────────────────────────────────── */

/**
 * Open-signups switch. Posts to /v1/admin/launch-status/open-signups and
 * refreshes the server component so peer-rendered state catches up. Shows
 * the env default underneath when the DB override differs from it so the
 * operator can see they've drifted.
 */
export function OpenSignupsControl({
  initialOpen,
  envDefault,
  apiOrigin,
}: {
  initialOpen: boolean;
  envDefault: boolean;
  apiOrigin: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingFlip, setPendingFlip] = useState<boolean | null>(null);

  async function flip(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/launch-status/open-signups`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ openSignups: next }),
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          // Stash the requested state so the post-step-up retry knows
          // which direction to flip.
          setPendingFlip(next);
          return;
        }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `flip failed: ${res.status}`);
      }
      setOpen(next);
      setConfirming(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'flip failed');
    } finally {
      setBusy(false);
    }
  }

  const drift = open !== envDefault;

  return (
    <HeroCard>
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-start gap-5">
          <span className="mt-2.5">
            <PulseDot active={open} activeColor="green" />
          </span>
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              signups
            </span>
            <span
              className={`font-mono text-3xl tracking-tight ${
                open ? 'text-[var(--color-success)]' : 'text-[var(--color-text)]'
              }`}
            >
              {open ? 'open' : 'invite-only'}
            </span>
            <span className="max-w-prose font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
              {open
                ? 'anyone with the URL can create an account at /signin right now. close it to go back to the invite-only allowlist.'
                : 'only emails on the allowlist can sign up. existing users keep working either way — this gate only affects brand-new registrations.'}
            </span>
            {drift ? (
              <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                env default is <code>BRIVEN_OPEN_SIGNUPS={envDefault ? 'true' : 'false'}</code> —
                this dashboard override wins.
              </span>
            ) : null}
          </div>
        </div>

        {!confirming ? (
          <button
            type="button"
            disabled={busy || pending}
            onClick={() => setConfirming(true)}
            className="rounded-md border border-[var(--color-border)] px-5 py-2.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            {open ? 'close signups' : 'open signups'}
          </button>
        ) : null}
      </div>

      {confirming ? (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-warning)] p-4 font-mono text-xs">
          <p className="text-[var(--color-text)]">
            {open
              ? 'pause new signups? existing users keep working — only new registrations are blocked.'
              : 'open signups to the public? anyone with the URL can register the moment you confirm.'}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || pending}
              onClick={() => void flip(!open)}
              className="rounded-md border border-[var(--color-warning)] px-4 py-2 font-mono text-xs text-[var(--color-warning)] transition hover:bg-[var(--color-warning)] hover:text-[var(--color-text-inverse)] disabled:opacity-50"
            >
              {busy ? 'flipping…' : 'confirm'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p> : null}

      {pendingFlip !== null ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason={
            pendingFlip
              ? 'flipping open-signups to true makes the platform publicly registrable. confirm with your password.'
              : 'closing public signups reverts to the invite-only allowlist. confirm with your password.'
          }
          onSuccess={async () => {
            const next = pendingFlip;
            setPendingFlip(null);
            if (next !== null) await flip(next);
          }}
          onCancel={() => setPendingFlip(null)}
        />
      ) : null}
    </HeroCard>
  );
}
