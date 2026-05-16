'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  currentEmail: string;
  apiOrigin: string;
}

export function ChangeEmailForm({ currentEmail, apiOrigin }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed || trimmed === currentEmail.toLowerCase()) {
      setError('Enter a different email address.');
      return;
    }
    setError(null);
    setSent(null);
    startTransition(async () => {
      try {
        const callbackURL = `${window.location.origin}/dashboard/settings?email_changed=1`;
        const res = await fetch(`${apiOrigin}/v1/auth/change-email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ newEmail: trimmed, callbackURL }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          let message = body;
          try {
            const parsed = JSON.parse(body) as { message?: string };
            if (parsed.message) message = parsed.message;
          } catch {
            // not JSON
          }
          setError(message || `request failed (${res.status})`);
          return;
        }
        setSent(trimmed);
        setNewEmail('');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'change failed');
      }
    });
  }

  if (sent) {
    return (
      <div className="mt-3 rounded-md border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] p-4 text-xs text-[var(--color-text)]">
        <p className="font-medium">Confirmation sent to {currentEmail}.</p>
        <p className="mt-1 text-[var(--color-text-muted)]">
          Click the link in that mailbox to switch your sign-in email to <strong>{sent}</strong>.
          The link expires in 1 hour. Until you confirm, you keep signing in with{' '}
          <strong>{currentEmail}</strong>.
        </p>
        <p className="mt-2 text-[var(--color-text-subtle)]">
          Outlook / Hotmail aggressively spam-filters transactional mail from new domains. If
          you don&apos;t see it within 5 minutes, check Junk and mark the address as not junk.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-xs text-[var(--color-text-link)] hover:underline"
      >
        Change sign-in email →
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 flex flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4"
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          New sign-in email
        </span>
        <input
          type="email"
          required
          value={newEmail}
          onChange={(e) => setNewEmail(e.currentTarget.value)}
          placeholder="you@example.com"
          maxLength={320}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
        />
        <span className="text-xs text-[var(--color-text-subtle)]">
          For security, the confirmation link goes to your <strong>current</strong> email
          ({currentEmail}). The change only takes effect after you click that link.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
        >
          {pending ? 'Sending…' : 'Send confirmation'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setNewEmail('');
            setError(null);
          }}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          Cancel
        </button>
        {error ? (
          <span role="alert" className="text-xs text-red-400">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
