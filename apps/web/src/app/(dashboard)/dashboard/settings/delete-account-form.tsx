'use client';

import { useState, type FormEvent } from 'react';

interface Props {
  email: string;
}

/**
 * Account deletion form. Typed-email confirmation gates the click so an
 * accidental "delete" can't go through. On success the api revokes the
 * session — we just redirect to /signin?deleted=1 and the page renders
 * the post-deletion banner.
 */
export function DeleteAccountForm({ email }: Props) {
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch('/api/v1/me/delete-account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confirmation: confirmation.trim(),
          reason: reason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        throw new Error(body.message ?? body.code ?? `delete failed: ${res.status}`);
      }
      // Session is gone server-side; bounce to the post-deletion banner.
      window.location.href = '/signin?deleted=1';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="mt-3 rounded-md border border-red-400/30 bg-red-400/5 p-5 font-mono text-sm">
      <summary className="cursor-pointer text-red-400">delete account</summary>
      <p className="mt-3 text-[var(--color-text-muted)]">
        soft-deletes your account immediately. you have <strong>30 days</strong> to revert
        via support before the data is hard-deleted. paid subscriptions are not
        auto-cancelled — manage cancellation on polar separately.
      </p>
      <ul className="mt-3 list-disc pl-5 text-xs text-[var(--color-text-subtle)]">
        <li>personal data on your account (legal name, address, vat, display name, image) is cleared.</li>
        <li>orgs you solely own — and every project under them — are soft-deleted.</li>
        <li>team orgs where you&apos;re not the only owner stay live; you&apos;re removed from membership.</li>
        <li>api keys you own are revoked.</li>
      </ul>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">
            type <code className="text-[var(--color-text)]">{email}</code> to confirm
          </span>
          <input
            type="email"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={email}
            autoComplete="off"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-red-400"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">
            why are you leaving? (optional — surfaced only in audit log)
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="anything we can fix?"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-red-400"
          />
        </label>
        {error ? (
          <p className="rounded-md bg-red-400/10 px-3 py-2 text-xs text-red-400">{error}</p>
        ) : null}
        <button
          type="submit"
          disabled={pending || confirmation.trim().toLowerCase() !== email.toLowerCase()}
          className="self-start rounded-md border border-red-500/40 px-4 py-2 text-sm text-red-400 transition hover:bg-red-500/10 disabled:opacity-30"
        >
          {pending ? 'deleting…' : 'permanently delete my account'}
        </button>
      </form>
    </details>
  );
}
