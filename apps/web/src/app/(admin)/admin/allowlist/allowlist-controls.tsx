'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '@/components/step-up-prompt';

interface Props {
  apiOrigin: string;
}

type Pending = { kind: 'add'; email: string; notes: string } | { kind: 'remove'; email: string };

export function AllowlistAddForm({ apiOrigin }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [, startTransition] = useTransition();

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/signup-allowlist`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPending({ kind: 'add', email: email.trim(), notes: notes.trim() });
          return;
        }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `add failed: ${res.status}`);
      }
      setEmail('');
      setNotes('');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'add failed');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    void add();
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="grid grid-cols-1 gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 md:grid-cols-[2fr_2fr_auto] md:items-end"
      >
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            email
          </span>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alice@example.com"
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            notes (optional)
          </span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="founder of acme.dev — met at handlr launch"
            maxLength={500}
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 font-sans text-sm text-[var(--color-text-inverse)] transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {busy ? 'adding…' : 'add'}
        </button>
      </form>

      {error ? (
        <p className="font-mono text-xs text-[var(--color-error)]">{error}</p>
      ) : null}

      {pending?.kind === 'add' ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason="adding an allowlist entry lets a new email sign up to the beta. confirm with your password."
          onSuccess={async () => {
            setPending(null);
            await add();
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </>
  );
}

export function AllowlistRemoveButton({
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

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiOrigin}/v1/admin/signup-allowlist/${encodeURIComponent(email)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPending(true);
          return;
        }
      }
      if (!res.ok && res.status !== 404) throw new Error(`remove failed: ${res.status}`);
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
        onClick={() => void remove()}
        disabled={busy}
        className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)] disabled:opacity-50"
      >
        {busy ? '…' : 'remove'}
      </button>
      {error ? (
        <p className="mt-1 font-mono text-[10px] text-[var(--color-error)]">{error}</p>
      ) : null}
      {pending ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason="removing an allowlist entry blocks future signups for this email. confirm with your password."
          onSuccess={async () => {
            setPending(false);
            await remove();
          }}
          onCancel={() => setPending(false)}
        />
      ) : null}
    </>
  );
}
