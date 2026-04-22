'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

interface Props {
  next: string;
  disabled?: boolean;
}

export function SignInForm({ next, disabled }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
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
      const url = new URL(window.location.href);
      url.searchParams.set('sent', '1');
      router.replace(`${url.pathname}${url.search}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-busy={pending}>
      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">email</span>
        <input
          type="email"
          autoComplete="email"
          required
          disabled={disabled || pending}
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          placeholder="you@example.com"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-50"
        />
      </label>

      <button
        type="submit"
        disabled={disabled || pending || !email}
        className="mt-2 inline-flex items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
      >
        {pending ? 'sending...' : 'send magic link'}
      </button>

      {error ? (
        <p role="alert" className="font-mono text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
