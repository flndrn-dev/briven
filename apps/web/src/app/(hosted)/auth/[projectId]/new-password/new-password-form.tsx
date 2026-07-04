'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface ErrorBody {
  code?: string;
  message?: string;
  error?: { code?: string; message?: string };
}

interface Props {
  projectId: string;
  /** token from ?token= query string; empty string when missing */
  token: string;
}

export function NewPasswordForm({ projectId, token }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Guard: token missing from URL (e.g. user navigated here directly)
  if (!token) {
    return (
      <article className="flex flex-col gap-5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <header>
          <h1 className="font-mono text-base text-[var(--color-text)]">invalid link</h1>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            this reset link is missing a token. please request a new one.
          </p>
        </header>
        <nav className="border-t border-[var(--color-border-subtle)] pt-4">
          <Link
            href={`/auth/${projectId}/reset-password`}
            className="font-mono text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
          >
            request a new reset link
          </Link>
        </nav>
      </article>
    );
  }

  if (done) {
    return (
      <article className="flex flex-col gap-5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <header>
          <h1 className="font-mono text-base text-[var(--color-text)]">password updated</h1>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            your password has been changed. sign in with your new password.
          </p>
        </header>
        <Link
          href={`/auth/${projectId}/sign-in`}
          className="self-start rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
        >
          sign in
        </Link>
      </article>
    );
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (password !== confirm) {
      setError('passwords do not match');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth-tenant/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-briven-project-id': projectId,
        },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as ErrorBody;
        // Better Auth returns specific codes for expired/invalid tokens
        const msg = err.error?.message ?? err.message ?? err.code ?? `http ${res.status}`;
        throw new Error(msg);
      }
      setDone(true);
      // Small delay so the user sees the success state before redirect
      setTimeout(() => { router.replace(`/auth/${projectId}/sign-in`); }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'password reset failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="flex flex-col gap-5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <header>
        <h1 className="font-mono text-base text-[var(--color-text)]">set new password</h1>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          choose a new password — at least 10 characters
        </p>
      </header>

      <form className="flex flex-col gap-3" onSubmit={(e) => void handleSubmit(e)}>
        <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
          <span>new password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            className="rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
        </label>
        <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
          <span>confirm password</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            className="rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'saving…' : 'set password'}
        </button>
      </form>

      {error ? (
        <p className="font-mono text-xs text-[var(--color-error)]" role="alert">
          {error}
        </p>
      ) : null}

      <nav className="border-t border-[var(--color-border-subtle)] pt-4">
        <Link
          href={`/auth/${projectId}/reset-password`}
          className="font-mono text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
        >
          request a new reset link
        </Link>
      </nav>
    </article>
  );
}
