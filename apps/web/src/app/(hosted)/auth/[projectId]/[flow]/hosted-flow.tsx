'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type FormFlow = 'sign-in' | 'sign-up' | 'magic-link' | 'otp' | 'new-password' | 'two-factor';

interface Props {
  projectId: string;
  flow: FormFlow;
  /** Where to send the user after successful authentication. */
  callbackURL: string;
  /** Password-reset token (only for new-password flow). */
  token?: string;
  /** Cloudflare Turnstile site key, or null when disabled. */
  turnstileSiteKey: string | null;
}

const OAUTH_PROVIDERS: ReadonlyArray<string> = [
  'google',
  'github',
  'discord',
  'microsoft',
  'apple',
  'twitter',
  'linkedin',
  'gitlab',
  'bitbucket',
  'dropbox',
  'facebook',
  'spotify',
];

const TITLES: Record<FormFlow, string> = {
  'sign-in': 'sign in',
  'sign-up': 'create account',
  'magic-link': 'sign in with magic link',
  otp: 'sign in with one-time code',
  'new-password': 'choose a new password',
  'two-factor': 'two-factor check',
};

const SUB_TITLES: Record<FormFlow, string> = {
  'sign-in': 'welcome back',
  'sign-up': 'no account yet',
  'magic-link': "we'll email you a one-shot sign-in link",
  otp: "we'll email you a 6-digit code",
  'new-password': 'enter your new password below',
  'two-factor': 'authenticator code or backup recovery code',
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
export function HostedFlow({ projectId, flow, callbackURL, token, turnstileSiteKey }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [twoFactorMode, setTwoFactorMode] = useState<'totp' | 'backup'>('totp');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);

  // Load Cloudflare Turnstile script when a site key is provided.
  useEffect(() => {
    if (!turnstileSiteKey || !turnstileRef.current) return;
    if (document.querySelector('script[data-turnstile-loaded]')) {
      renderTurnstile();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.setAttribute('data-turnstile-loaded', 'true');
    script.onload = () => renderTurnstile();
    document.body.appendChild(script);
    return () => {
      // Cleanup handled by Turnstile internally on re-render.
    };
  }, [turnstileSiteKey]);

  function renderTurnstile() {
    const win = window as unknown as {
      turnstile?: {
        render: (
          el: HTMLElement,
          opts: {
            sitekey: string;
            callback: (token: string) => void;
            'error-callback'?: () => void;
          },
        ) => string;
      };
    };
    if (!win.turnstile || !turnstileRef.current) return;
    win.turnstile.render(turnstileRef.current, {
      sitekey: turnstileSiteKey!,
      callback: (t) => setTurnstileToken(t),
      'error-callback': () => setTurnstileToken(null),
    });
  }

  async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
    setPending(true);
    setError(null);
    try {
      const payload = turnstileToken ? { ...body, turnstileToken } : body;
      const res = await fetch(`/api/v1/auth-tenant${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-briven-project-id': projectId,
        },
        body: JSON.stringify(payload),
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
      const body = (await post('/sign-in/email', { email, password })) as {
        twoFactorRedirect?: boolean;
        user?: { id?: string };
      };
      // Password ok but account has 2FA — continue on the challenge page.
      if (body?.twoFactorRedirect === true) {
        router.push(
          `/auth/${projectId}/two-factor?callbackURL=${encodeURIComponent(callbackURL)}`,
        );
        return;
      }
      router.push(callbackURL);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sign-in failed');
    }
  }

  async function handleTwoFactor(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    try {
      if (twoFactorMode === 'totp') {
        await post('/two-factor/verify-totp', { code: twoFactorCode });
      } else {
        await post('/two-factor/verify-backup-code', { code: twoFactorCode });
      }
      router.push(callbackURL);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : twoFactorMode === 'totp'
            ? 'authenticator code failed'
            : 'backup code failed',
      );
    }
  }

  async function handleSignUp(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    try {
      await post('/sign-up/email', { email, password, name: name || undefined });
      router.push(callbackURL);
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
      router.push(callbackURL);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'otp verify failed');
    }
  }

  async function handleNewPassword(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!token) {
      setError('missing reset token');
      return;
    }
    try {
      await post('/reset-password', { token, newPassword });
      setResetDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'password reset failed');
    }
  }

  function oauthHref(provider: string): string {
    const params = new URLSearchParams({
      provider,
      callbackURL,
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
        <form className="flex flex-col gap-3" onSubmit={handleSignIn}>
          <Field label="email" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <Field
            label="password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          {turnstileSiteKey ? <div ref={turnstileRef} className="min-h-[65px]" /> : null}
          <Submit pending={pending} idle="sign in" busy="signing in…" />
        </form>
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
          {turnstileSiteKey ? <div ref={turnstileRef} className="min-h-[65px]" /> : null}
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
            {turnstileSiteKey ? <div ref={turnstileRef} className="min-h-[65px]" /> : null}
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
            {turnstileSiteKey ? <div ref={turnstileRef} className="min-h-[65px]" /> : null}
            <Submit pending={pending} idle="send code" busy="sending…" />
          </form>
        )
      ) : null}

      {flow === 'new-password' ? (
        resetDone ? (
          <div className="flex flex-col gap-3">
            <p className="font-mono text-xs text-[var(--color-text-muted)]">
              password updated. you can now sign in with your new password.
            </p>
            <Link
              href={`/auth/${projectId}/sign-in`}
              className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-center font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
            >
              sign in
            </Link>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={handleNewPassword}>
            <Field
              label="new password"
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
            />
            <Submit pending={pending} idle="reset password" busy="resetting…" />
          </form>
        )
      ) : null}

      {flow === 'two-factor' ? (
        <form className="flex flex-col gap-3" onSubmit={handleTwoFactor}>
          <Field
            label={twoFactorMode === 'totp' ? '6-digit code' : 'backup recovery code'}
            type="text"
            value={twoFactorCode}
            onChange={setTwoFactorCode}
            autoComplete={twoFactorMode === 'totp' ? 'one-time-code' : undefined}
            inputMode={twoFactorMode === 'totp' ? 'numeric' : 'text'}
            pattern={twoFactorMode === 'totp' ? '\\d{6}' : undefined}
            maxLength={twoFactorMode === 'totp' ? 6 : undefined}
          />
          <Submit
            pending={pending}
            idle={twoFactorMode === 'totp' ? 'verify' : 'use backup code'}
            busy="checking…"
          />
          <button
            type="button"
            className="font-mono text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
            onClick={() => {
              setTwoFactorMode(twoFactorMode === 'totp' ? 'backup' : 'totp');
              setTwoFactorCode('');
              setError(null);
            }}
          >
            {twoFactorMode === 'totp'
              ? 'lost your phone? use a backup code'
              : 'use authenticator code instead'}
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="font-mono text-xs text-[var(--color-error)]" role="alert">
          {error}
        </p>
      ) : null}

      {flow !== 'new-password' && flow !== 'two-factor' ? (
        <div className="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-4">
          <p className="text-center font-mono text-[11px] text-[var(--color-text-subtle)]">
            or continue with
          </p>
          <div className="grid grid-cols-2 gap-2">
            {OAUTH_PROVIDERS.map((p) => (
              <a
                key={p}
                href={oauthHref(p)}
                className="rounded-md border border-[var(--color-border)] px-3 py-2 text-center font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
              >
                {p}
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
        {flow !== 'sign-up' && flow !== 'two-factor' ? (
          <Link
            href={`/auth/${projectId}/sign-up`}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
          >
            create account
          </Link>
        ) : null}
        {flow !== 'magic-link' && flow !== 'two-factor' ? (
          <Link
            href={`/auth/${projectId}/magic-link`}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
          >
            magic link
          </Link>
        ) : null}
        {flow !== 'otp' && flow !== 'two-factor' ? (
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
