'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '../../../../../components/step-up-prompt';

interface Props {
  apiOrigin: string;
}

type PendingAction =
  | { kind: 'suppress'; email: string }
  | { kind: 'unsuppress'; email: string };

/**
 * Holds the add-suppression form and surfaces a global step-up prompt
 * shared across the page's two write surfaces (add new, remove
 * existing). Per-row remove buttons live in the sibling table inside
 * a sub-component that calls into this controller via custom event,
 * but for the launch slice we keep it inline: each row renders its
 * own remove button via the same patch handler exposed below.
 *
 * The single hidden form pattern means the operator types their
 * password once for a burst of suppressions instead of per-row.
 */
export function SuppressionControls({ apiOrigin }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [, startTransition] = useTransition();

  async function run(action: PendingAction) {
    setBusy(true);
    setError(null);
    try {
      const res =
        action.kind === 'suppress'
          ? await fetch(`${apiOrigin}/v1/admin/email-suppressions`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email: action.email, reason: 'manual' }),
            })
          : await fetch(
              `${apiOrigin}/v1/admin/email-suppressions/${encodeURIComponent(action.email)}`,
              { method: 'DELETE', credentials: 'include' },
            );
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPending(action);
          return;
        }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `${action.kind} failed: ${res.status}`);
      }
      if (action.kind === 'suppress') setEmail('');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action.kind} failed`);
    } finally {
      setBusy(false);
    }
  }

  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    void run({ kind: 'suppress', email: trimmed });
  }

  return (
    <>
      <form
        onSubmit={submitAdd}
        className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-xs"
      >
        <span className="text-[var(--color-text-muted)]">add manual:</span>
        <input
          type="email"
          required
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          className="flex-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 outline-none focus:border-[var(--color-primary)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1 font-medium text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {busy && pending?.kind === 'suppress' ? 'adding…' : 'suppress'}
        </button>
      </form>

      {error ? (
        <p className="font-mono text-xs text-[var(--color-error)]">{error}</p>
      ) : null}

      {pending ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason={
            pending.kind === 'suppress'
              ? 'adding a manual suppression blocks email delivery to this address. confirm with your password.'
              : 'removing a suppression re-enables delivery to a previously bounced address. confirm with your password.'
          }
          onSuccess={async () => {
            const action = pending;
            setPending(null);
            await run(action);
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Per-row remove button. Kept simple — fires a fetch against the
 * delete endpoint, surfaces step-up via a row-local prompt. The
 * trade-off: typing your password twice within 10 min of each other
 * is fine because the auth window is bumped on the first success.
 */
export function RemoveSuppressionButton({
  email,
  apiOrigin,
}: {
  email: string;
  apiOrigin: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiOrigin}/v1/admin/email-suppressions/${encodeURIComponent(email)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPending(true);
          return;
        }
      }
      if (!res.ok) throw new Error(`remove failed: ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'remove failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] disabled:opacity-50"
      >
        {busy ? '…' : 'remove'}
      </button>
      {error ? (
        <p className="mt-1 font-mono text-[10px] text-[var(--color-error)]">{error}</p>
      ) : null}
      {pending ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason="removing a suppression re-enables delivery. confirm with your password."
          onSuccess={async () => {
            setPending(false);
            await run();
          }}
          onCancel={() => setPending(false)}
        />
      ) : null}
    </>
  );
}
