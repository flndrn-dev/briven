'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { FaDiscord, FaGithub } from 'react-icons/fa';
import { FcGoogle } from 'react-icons/fc';

export interface Providers {
  google: boolean;
  github: boolean;
  discord: boolean;
  konnos: boolean;
}

interface Props {
  next: string;
  apiOrigin: string;
  disabled?: boolean;
  providers: Providers;
}

/**
 * Google / GitHub / Discord → Better Auth socialProviders (/sign-in/social).
 * Konnos (Git at code.konnos.org) → genericOAuth (/sign-in/oauth2, providerId: konnos).
 */
type SocialKind = 'google' | 'github' | 'discord';
type ProviderKind = SocialKind | 'konnos';

function formatMmSs(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function SignInForm({ next, apiOrigin, disabled, providers }: Props) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<ProviderKind | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Seconds left until we recommend checking spam (starts at 2:00). */
  const [spamCountdown, setSpamCountdown] = useState(120);

  useEffect(() => {
    if (!sent) return;
    setSpamCountdown(120);
    const id = window.setInterval(() => {
      setSpamCountdown((prev) => (prev <= 0 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [sent]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const callbackURL = `${window.location.origin}${next}`;
      const res = await fetch(`${apiOrigin}/v1/auth/sign-in/magic-link`, {
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

  async function onSocial(kind: SocialKind) {
    setOauthPending(kind);
    setError(null);
    try {
      const callbackURL = `${window.location.origin}${next}`;
      const errorCallbackURL = `${window.location.origin}/signin?error=oauth_${kind}`;
      const res = await fetch(`${apiOrigin}/v1/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: kind, callbackURL, errorCallbackURL }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `request failed (${res.status})`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error('no redirect url returned');
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : `${kind} sign-in failed`);
      setOauthPending(null);
    }
  }

  async function onKonnos() {
    setOauthPending('konnos');
    setError(null);
    try {
      const callbackURL = `${window.location.origin}${next}`;
      const errorCallbackURL = `${window.location.origin}/signin?error=oauth_konnos`;
      // genericOAuth plugin endpoint (not socialProviders)
      const res = await fetch(`${apiOrigin}/v1/auth/sign-in/oauth2`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          providerId: 'konnos',
          callbackURL,
          errorCallbackURL,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `request failed (${res.status})`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error('no redirect url returned');
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'konnos sign-in failed');
      setOauthPending(null);
    }
  }

  const anyPending = pending || oauthPending !== null;
  const anyOAuth =
    providers.google || providers.github || providers.discord || providers.konnos;

  if (sent) {
    const isOutlookFamily = /@(hotmail|outlook|live|msn)\./i.test(email);
    const clock = formatMmSs(spamCountdown);
    const spamHint =
      spamCountdown > 0
        ? `don't see it yet? wait for the timer (${clock}), then check spam / junk${
            isOutlookFamily
              ? ' — outlook / hotmail / live / msn often hide new senders'
              : ''
          }.`
        : `don't see it? check spam / junk now${
            isOutlookFamily
              ? ' — outlook / hotmail / live / msn often hide new senders'
              : ''
          }.`;

    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-5 font-mono text-sm">
          <p className="text-[var(--color-text)]">check your inbox</p>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            we sent a one-time link to{' '}
            <span className="text-[var(--color-text)]">{email}</span>. click it to finish
            signing in. the link expires in 10 minutes.
          </p>

          <div className="mt-5 flex w-full justify-center">
            <div
              className="inline-flex flex-col items-center gap-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-5 py-3"
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
                check spam after
              </span>
              <span className="font-mono text-2xl tabular-nums tracking-tight text-[var(--color-text)]">
                {clock}
              </span>
            </div>
          </div>

          <ul className="mt-3 flex flex-col gap-1 text-xs text-[var(--color-text-subtle)]">
            <li>· {spamHint}</li>
            <li>
              · prefer google, github, or konnos? go back and use those buttons instead.
            </li>
          </ul>
        </div>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setEmail('');
            setSpamCountdown(120);
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
      {anyOAuth ? (
        <>
          {providers.google ? (
            <button
              type="button"
              onClick={() => onSocial('google')}
              disabled={disabled || anyPending}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 font-mono text-sm text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center">
                <FcGoogle />
              </span>
              {oauthPending === 'google' ? 'redirecting...' : 'continue with google'}
            </button>
          ) : null}

          {providers.github ? (
            <button
              type="button"
              onClick={() => onSocial('github')}
              disabled={disabled || anyPending}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 font-mono text-sm text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center">
                <FaGithub />
              </span>
              {oauthPending === 'github' ? 'redirecting...' : 'continue with github'}
            </button>
          ) : null}

          {providers.konnos ? (
            <button
              type="button"
              onClick={() => void onKonnos()}
              disabled={disabled || anyPending}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 font-mono text-sm text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
            >
              {/* Official Konnos mark (logo.svg) — auto when Konnos OAuth is on */}
              <img
                src="/konnos.svg"
                alt=""
                width={20}
                height={20}
                className="h-5 w-5 rounded-sm object-contain"
                aria-hidden
              />
              {oauthPending === 'konnos' ? 'redirecting...' : 'continue with konnos'}
            </button>
          ) : null}

          {providers.discord ? (
            <button
              type="button"
              onClick={() => onSocial('discord')}
              disabled={disabled || anyPending}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 font-mono text-sm text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center text-[#5865F2]">
                <FaDiscord />
              </span>
              {oauthPending === 'discord' ? 'redirecting...' : 'continue with discord'}
            </button>
          ) : null}

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
            <span className="font-mono text-xs text-[var(--color-text-subtle)]">or</span>
            <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
          </div>
        </>
      ) : null}

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
