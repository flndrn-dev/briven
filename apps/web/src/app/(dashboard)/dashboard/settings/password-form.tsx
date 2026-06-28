'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

interface Props {
  /** Whether the account already has a password (change vs set first one). */
  hasPassword: boolean;
  apiOrigin: string;
}

/**
 * Set or change the account password — NO email round-trip. Posts to
 * apps/api's POST /v1/me/password on the authenticated session; the api
 * routes a passwordless user to Better Auth setPassword (adds a first
 * password) and an existing-password user to changePassword. A password is
 * what the destructive-action step-up confirms against, so passwordless
 * users need to set one here before they can delete a project.
 */
export function PasswordForm({ hasPassword, apiOrigin }: Props) {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
    if (next !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (hasPassword && current.length === 0) {
      setError('Enter your current password.');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`${apiOrigin}/v1/me/password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(
            hasPassword ? { currentPassword: current, newPassword: next } : { newPassword: next },
          ),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          let message = body;
          try {
            const parsed = JSON.parse(body) as { message?: string };
            if (parsed.message) message = parsed.message;
          } catch {
            // not JSON — keep raw text
          }
          setError(message || `request failed (${res.status})`);
          return;
        }
        setCurrent('');
        setNext('');
        setConfirm('');
        setDone(true);
        // Refresh so /v1/me re-reads hasPassword and the form flips to
        // "change password" mode.
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'request failed');
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-4 flex max-w-md flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4"
    >
      {hasPassword ? (
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            Current password
          </span>
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.currentTarget.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
        </label>
      ) : null}
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          {hasPassword ? 'New password' : 'Password'}
        </span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={next}
          onChange={(e) => setNext(e.currentTarget.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          Confirm {hasPassword ? 'new ' : ''}password
        </span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={confirm}
          onChange={(e) => setConfirm(e.currentTarget.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
        />
      </label>
      <span className="text-xs text-[var(--color-text-subtle)]">Use at least 10 characters.</span>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
        >
          {pending
            ? 'Saving…'
            : hasPassword
              ? 'Change password'
              : 'Set password'}
        </button>
        {done ? (
          <span role="status" className="text-xs text-[var(--color-primary)]">
            {hasPassword ? 'Password changed.' : 'Password set.'}
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="text-xs text-red-400">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
