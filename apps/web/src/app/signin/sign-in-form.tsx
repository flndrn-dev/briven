'use client';

import { useState, type FormEvent } from 'react';
import { FaDiscord, FaGithub } from 'react-icons/fa';
import { FcGoogle } from 'react-icons/fc';

export interface Providers {
  google: boolean;
  github: boolean;
  konnos: boolean;
  discord: boolean;
}

interface Props {
  next: string;
  apiOrigin: string;
  disabled?: boolean;
  providers: Providers;
}

/**
 * Konnos logo — Forgejo at code.konnos.org doesn't have a brand mark
 * we can reuse, so the button shows a literal "K" badge in the green
 * primary colour to match the briven mark. Kept inline so the bundle
 * doesn't grow for a single tile glyph.
 */
function KonnosMark() {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-[var(--color-primary)] text-[10px] font-bold text-[var(--color-text-inverse)]">
      K
    </span>
  );
}

/**
 * `social` vs `oauth2`: Google + GitHub are first-class in Better Auth's
 * socialProviders config, so they go through /v1/auth/sign-in/social.
 * Konnos (Forgejo) is registered via the genericOAuth plugin, which
 * exposes /v1/auth/sign-in/oauth2 with a `providerId` field.
 */
type ProviderKind = 'google' | 'github' | 'konnos' | 'discord';

export function SignInForm({ next, apiOrigin, disabled, providers }: Props) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<ProviderKind | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Why we POST directly to the api origin instead of going through the
  // Next.js `/api/...` rewrite: in production, edge proxies (Cloudflare,
  // some CDNs) inspect rewrite-proxied request bodies and can corrupt
  // Better Auth's callbackURL validation, producing a spurious
  // INVALID_CALLBACK_URL 403. Talking directly to the api avoids the
  // proxy hop entirely. CORS on the api allows the dashboard origin.
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

  async function onOAuth(kind: ProviderKind) {
    setOauthPending(kind);
    setError(null);
    try {
      const callbackURL = `${window.location.origin}${next}`;
      const endpoint =
        kind === 'konnos' ? '/v1/auth/sign-in/oauth2' : '/v1/auth/sign-in/social';
      const body =
        kind === 'konnos'
          ? { providerId: 'konnos', callbackURL }
          : { provider: kind, callbackURL };
      const res = await fetch(`${apiOrigin}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
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

  const anyPending = pending || oauthPending !== null;
  const anyOAuth =
    providers.google || providers.github || providers.konnos || providers.discord;

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
      {anyOAuth ? (
        <>
          {providers.google ? (
            <button
              type="button"
              onClick={() => onOAuth('google')}
              disabled={disabled || anyPending}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 font-mono text-sm text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
            >
              <FcGoogle className="h-5 w-5" />
              {oauthPending === 'google' ? 'redirecting...' : 'continue with google'}
            </button>
          ) : null}

          {providers.github ? (
            <button
              type="button"
              onClick={() => onOAuth('github')}
              disabled={disabled || anyPending}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 font-mono text-sm text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
            >
              <FaGithub className="h-5 w-5" />
              {oauthPending === 'github' ? 'redirecting...' : 'continue with github'}
            </button>
          ) : null}

          {providers.konnos ? (
            <button
              type="button"
              onClick={() => onOAuth('konnos')}
              disabled={disabled || anyPending}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 font-mono text-sm text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
            >
              <KonnosMark />
              {oauthPending === 'konnos' ? 'redirecting...' : 'continue with konnos'}
            </button>
          ) : null}

          {providers.discord ? (
            <button
              type="button"
              onClick={() => onOAuth('discord')}
              disabled={disabled || anyPending}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 font-mono text-sm text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
            >
              <FaDiscord className="h-5 w-5 text-[#5865F2]" />
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
