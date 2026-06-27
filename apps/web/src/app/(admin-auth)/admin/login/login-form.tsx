'use client';

import { useState, type FormEvent } from 'react';

/**
 * Bare superadmin sign-in: email + password ONLY.
 *
 * Reuses the EXISTING Better Auth email+password endpoint
 * (POST /v1/auth/sign-in/email) through the same-origin /api/* rewrite,
 * so there is no new auth system, no CORS, and cookies are set on the
 * same origin the page is served from. After a successful sign-in we
 * confirm the session is an admin via /api/v1/me before entering the
 * cockpit; a non-admin is signed straight back out.
 *
 * Only the two credential fields are offered here — nothing else, by design.
 */
export function AdminLoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        // Never reveal which field was wrong.
        setError('invalid email or password');
        setPending(false);
        return;
      }

      // Confirm admin before letting them into the cockpit.
      const meRes = await fetch('/api/v1/me', { credentials: 'include' });
      if (!meRes.ok) {
        setError('invalid email or password');
        setPending(false);
        return;
      }
      const me = (await meRes.json()) as { isAdmin?: boolean };
      if (!me.isAdmin) {
        // Signed in fine, but not authorized for the cockpit — sign back out.
        await fetch('/api/v1/auth/sign-out', {
          method: 'POST',
          credentials: 'include',
        }).catch(() => undefined);
        setError('not authorized');
        setPending(false);
        return;
      }

      window.location.href = '/admin';
    } catch {
      setError('invalid email or password');
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
          disabled={pending}
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-50"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-50"
        />
      </label>

      <button
        type="submit"
        disabled={pending || !email || !password}
        className="mt-2 inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
      >
        {pending ? 'signing in...' : 'sign in'}
      </button>

      {error ? (
        <p role="alert" className="font-mono text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
