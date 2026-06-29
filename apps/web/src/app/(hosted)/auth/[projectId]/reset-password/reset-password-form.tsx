'use client';

import Link from 'next/link';
import { useState } from 'react';

interface ErrorBody {
  code?: string;
  message?: string;
  error?: { code?: string; message?: string };
}

interface Props {
  projectId: string;
}

export function ResetPasswordForm({ projectId }: Props) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      // Endpoint confirmed against better-auth@1.6.9: the password-reset SENDER
      // is `/request-password-reset` (there is no `/forget-password` alias in
      // 1.6.9). The api's `sendResetPassword` callback builds the email link as
      // `${BRIVEN_WEB_ORIGIN}/auth/${projectId}/new-password?token=…`, which is
      // this same origin + path (window.location.origin), so the two agree.
      const res = await fetch('/api/v1/auth-tenant/request-password-reset', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-briven-project-id': projectId,
        },
        body: JSON.stringify({
          email,
          // redirectTo is sent for completeness; the api ignores Better Auth's
          // default URL and emails our raw-token link (resetPasswordUrl) instead.
          redirectTo: `${window.location.origin}/auth/${projectId}/new-password`,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as ErrorBody;
        throw new Error(err.error?.message ?? err.message ?? err.code ?? `http ${res.status}`);
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <article className="flex flex-col gap-5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <header>
          <h1 className="font-mono text-base text-[var(--color-text)]">check your email</h1>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            we sent a reset link to {email}
          </p>
        </header>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          click the link in the email to set a new password. close this tab when done, or{' '}
          <button
            type="button"
            onClick={() => { setSent(false); setEmail(''); }}
            className="text-[var(--color-primary)] hover:underline"
          >
            try again
          </button>
          .
        </p>
        <nav className="border-t border-[var(--color-border-subtle)] pt-4">
          <Link
            href={`/auth/${projectId}/sign-in`}
            className="font-mono text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
          >
            ← back to sign in
          </Link>
        </nav>
      </article>
    );
  }

  return (
    <article className="flex flex-col gap-5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <header>
        <h1 className="font-mono text-base text-[var(--color-text)]">reset password</h1>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          enter your email — we&apos;ll send a reset link
        </p>
      </header>

      <form className="flex flex-col gap-3" onSubmit={(e) => void handleSubmit(e)}>
        <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
          <span>email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'sending…' : 'send reset link'}
        </button>
      </form>

      {error ? (
        <p className="font-mono text-xs text-[var(--color-error)]" role="alert">
          {error}
        </p>
      ) : null}

      <nav className="border-t border-[var(--color-border-subtle)] pt-4">
        <Link
          href={`/auth/${projectId}/sign-in`}
          className="font-mono text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
        >
          ← back to sign in
        </Link>
      </nav>
    </article>
  );
}
