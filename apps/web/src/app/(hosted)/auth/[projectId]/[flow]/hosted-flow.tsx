'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PasskeySignIn } from '../passkey-sign-in';

type FormFlow = 'sign-in' | 'sign-up' | 'magic-link' | 'otp';

interface Props {
  projectId: string;
  flow: FormFlow;
  /**
   * The project's ENABLED OAuth/OIDC providers, resolved server-side from the
   * public branding/config endpoint. Buttons render ONLY for these — never the
   * old hard-coded "all five" list — so an unconfigured provider is never shown.
   */
  providers: string[];
  /** Display labels for custom-OIDC providers (built-ins fall back to the key). */
  providerLabels: Record<string, string>;
}

const TITLES: Record<FormFlow, string> = {
  'sign-in': 'sign in',
  'sign-up': 'create account',
  'magic-link': 'sign in with magic link',
  otp: 'sign in with one-time code',
};

const SUB_TITLES: Record<FormFlow, string> = {
  'sign-in': 'welcome back',
  'sign-up': 'no account yet',
  'magic-link': "we'll email you a one-shot sign-in link",
  otp: "we'll email you a 6-digit code",
};

interface ErrorBody {
  code?: string;
  message?: string;
  error?: { code?: string; message?: string };
}

/**
 * Hosted-pages flow forms. Same origin as the dashboard's api proxy
 * (`/api/v1/...`), so cookies set on `briven.tech` are forwarded
 * automatically. Subdomain split (`<tenant>.auth.briven.tech`) lands
 * with the CNAME orchestration runbook (BUILD_PLAN.md "Decisions
 * locked" Q7); the form contract here doesn't change.
 */
export function HostedFlow({ projectId, flow, providers, providerLabels }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);

  async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/auth-tenant${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-briven-project-id': projectId,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as ErrorBody;
        throw new Error(err.error?.message ?? err.message ?? err.code ?? `http ${res.status}`);
      }
      return await res.json();
    } finally {
      setPending(false);
    }
  }

  async function handleSignIn(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    try {
      await post('/sign-in/email', { email, password });
      router.push(`/auth/${projectId}/account`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sign-in failed');
    }
  }

  async function handleSignUp(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    try {
      await post('/sign-up/email', { email, password, name: name || undefined });
      router.push(`/auth/${projectId}/account`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sign-up failed');
    }
  }

  async function handleMagic(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    try {
      await post('/sign-in/magic-link', { email });
      setMagicSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'magic-link request failed');
    }
  }

  async function handleOtpRequest(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    try {
      await post('/sign-in/email-otp/send-verification-otp', { email });
      setOtpRequested(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'otp request failed');
    }
  }

  async function handleOtpVerify(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    try {
      await post('/sign-in/email-otp/verify', { email, otp });
      router.push(`/auth/${projectId}/account`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'otp verify failed');
    }
  }

  function oauthHref(provider: string): string {
    const params = new URLSearchParams({
      provider,
      callbackURL: `/auth/${projectId}/account`,
      projectId,
    });
    return `/api/v1/auth-tenant/sign-in/social?${params.toString()}`;
  }

  return (
    <article className="flex flex-col gap-5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <header>
        <h1 className="font-mono text-base text-[var(--color-text)]">{TITLES[flow]}</h1>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          {SUB_TITLES[flow]}
        </p>
      </header>

      {flow === 'sign-in' ? (
        <div className="flex flex-col gap-3">
          <form className="flex flex-col gap-3" onSubmit={handleSignIn}>
            <Field label="email" type="email" value={email} onChange={setEmail} autoComplete="email" />
            <Field
              label="password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
            <Submit pending={pending} idle="sign in" busy="signing in…" />
          </form>
          <div className="flex justify-end">
            <Link
              href={`/auth/${projectId}/reset-password`}
              className="font-mono text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
            >
              forgot password?
            </Link>
          </div>
          <PasskeySignIn projectId={projectId} />
        </div>
      ) : null}

      {flow === 'sign-up' ? (
        <form className="flex flex-col gap-3" onSubmit={handleSignUp}>
          <Field label="name" type="text" value={name} onChange={setName} autoComplete="name" />
          <Field label="email" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <Field
            label="password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          <Submit pending={pending} idle="create account" busy="creating…" />
        </form>
      ) : null}

      {flow === 'magic-link' ? (
        magicSent ? (
          <p className="font-mono text-xs text-[var(--color-text-muted)]">
            check your inbox for the sign-in link. close this tab when done.
          </p>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={handleMagic}>
            <Field label="email" type="email" value={email} onChange={setEmail} autoComplete="email" />
            <Submit pending={pending} idle="send magic link" busy="sending…" />
          </form>
        )
      ) : null}

      {flow === 'otp' ? (
        otpRequested ? (
          <form className="flex flex-col gap-3" onSubmit={handleOtpVerify}>
            <Field
              label="6-digit code"
              type="text"
              value={otp}
              onChange={setOtp}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
            />
            <Submit pending={pending} idle="verify" busy="verifying…" />
          </form>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={handleOtpRequest}>
            <Field label="email" type="email" value={email} onChange={setEmail} autoComplete="email" />
            <Submit pending={pending} idle="send code" busy="sending…" />
          </form>
        )
      ) : null}

      {error ? (
        <p className="font-mono text-xs text-[var(--color-error)]" role="alert">
          {error}
        </p>
      ) : null}

      {providers.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-4">
          <p className="text-center font-mono text-[11px] text-[var(--color-text-subtle)]">
            or continue with
          </p>
          <div className="grid grid-cols-2 gap-2">
            {providers.map((p) => (
              <a
                key={p}
                href={oauthHref(p)}
                className="rounded-md border border-[var(--color-border)] px-3 py-2 text-center font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
              >
                {providerLabels[p] ?? p}
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <nav className="flex flex-wrap justify-center gap-3 font-mono text-[11px]">
        {flow !== 'sign-in' ? (
          <Link
            href={`/auth/${projectId}/sign-in`}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
          >
            password sign-in
          </Link>
        ) : null}
        {flow !== 'sign-up' ? (
          <Link
            href={`/auth/${projectId}/sign-up`}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
          >
            create account
          </Link>
        ) : null}
        {flow !== 'magic-link' ? (
          <Link
            href={`/auth/${projectId}/magic-link`}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
          >
            magic link
          </Link>
        ) : null}
        {flow !== 'otp' ? (
          <Link
            href={`/auth/${projectId}/otp`}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
          >
            email code
          </Link>
        ) : null}
      </nav>
    </article>
  );
}

interface FieldProps {
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  inputMode?: 'numeric' | 'text';
  pattern?: string;
  maxLength?: number;
}

function Field(props: FieldProps) {
  return (
    <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
      <span>{props.label}</span>
      <input
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        required
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        pattern={props.pattern}
        maxLength={props.maxLength}
        className="rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
      />
    </label>
  );
}

interface SubmitProps {
  pending: boolean;
  idle: string;
  busy: string;
}

function Submit({ pending, idle, busy }: SubmitProps) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
    >
      {pending ? busy : idle}
    </button>
  );
}
