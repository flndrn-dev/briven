'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '../../../../components/step-up-prompt';

interface Props {
  initialOpen: boolean;
  envDefault: boolean;
  apiOrigin: string;
}

/**
 * Open-signups toggle. Posts to /v1/admin/launch-status/open-signups
 * and refreshes the server component so peer-rendered server state
 * (e.g. the LaunchPanel pill) catches up. Shows the env default
 * underneath when the DB override differs from it so the operator
 * can see they've drifted.
 */
export function OpenSignupsToggle({ initialOpen, envDefault, apiOrigin }: Props) {
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
  const stateTone = open
    ? 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]'
    : 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]';

  return (
    <li className="flex flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">signups</span>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${stateTone}`}
        >
          {open ? 'open' : 'invite-only'}
        </span>
      </div>

      <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
        {open
          ? 'public can sign up directly at /signin. anyone with the URL can create an account.'
          : "only emails on the allowlist can sign up. add beta testers via the allowlist tab."}
      </p>

      {drift ? (
        <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          env default is{' '}
          <code>BRIVEN_OPEN_SIGNUPS={envDefault ? 'true' : 'false'}</code> — dashboard override
          wins.
        </p>
      ) : null}

      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-[var(--color-warning)]">
            {open
              ? 'pause new signups? existing users keep working.'
              : 'open signups to the public? anyone with the URL can register.'}
          </span>
          <button
            type="button"
            disabled={busy || pending}
            onClick={() => flip(!open)}
            className="rounded-md border border-[var(--color-warning)] px-2 py-1 font-mono text-[10px] text-[var(--color-warning)] hover:bg-[var(--color-warning)] hover:text-[var(--color-text-inverse)] disabled:opacity-50"
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
      ) : (
        <button
          type="button"
          disabled={busy || pending}
          onClick={() => setConfirming(true)}
          className="self-start rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] disabled:opacity-50"
        >
          {open ? 'close signups' : 'open signups'}
        </button>
      )}

      {error ? (
        <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p>
      ) : null}

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
    </li>
  );
}
