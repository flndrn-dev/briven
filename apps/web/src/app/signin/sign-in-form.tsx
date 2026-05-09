'use client';

import { useState, type FormEvent } from 'react';
import { RiGithubFill } from 'react-icons/ri';

interface Props {
  next: string;
  disabled?: boolean;
}

export function SignInForm({ next, disabled }: Props) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const callbackURL = `${window.location.origin}${next}`;
      const res = await fetch('/api/v1/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, callbackURL }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `request failed (${res.status})`);
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
    } finally {
      setPending(false);
    }
  }

  async function onGithub() {
    setOauthPending(true);
    setError(null);
    try {
      const callbackURL = `${window.location.origin}${next}`;
      const res = await fetch('/api/v1/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: 'github', callbackURL }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `request failed (${res.status})`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error('no redirect url returned');
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'github sign-in failed');
      setOauthPending(false);
    }
  }

  const anyPending = pending || oauthPending;

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-5 font-mono text-sm">
          <p className="text-[var(--color-text)]">check your inbox</p>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            we sent a one-time link to <span className="text-[var(--color-text)]">{email}</span>.
            click it to finish signing in. the link expires in 10 minutes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setEmail('');
          }}
          className="self-start font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          ← use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" aria-busy={anyPending}>
      <button
        type="button"
        onClick={onGithub}
        disabled={disabled || anyPending}
        className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 font-mono text-sm text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
      >
        <RiGithubFill className="h-5 w-5" />
        {oauthPending ? 'redirecting...' : 'continue with github'}
      </button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
        <span className="font-mono text-xs text-[var(--color-text-subtle)]">or</span>
        <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">email</span>
          <input
            type="email"
            autoComplete="email"
            required
            disabled={disabled || anyPending}
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            placeholder="you@example.com"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-50"
          />
        </label>

        <button
          type="submit"
          disabled={disabled || anyPending || !email}
          className="mt-2 inline-flex items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'sending...' : 'send magic link'}
        </button>
      </form>

      {error ? (
        <p role="alert" className="font-mono text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
