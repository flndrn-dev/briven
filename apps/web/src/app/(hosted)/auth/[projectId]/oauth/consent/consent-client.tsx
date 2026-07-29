'use client';

import { useCallback, useEffect, useState } from 'react';

type Challenge = {
  client: { clientId: string; name: string; logoUrl: string | null };
  scopes: string[];
  scope: string;
};

const SCOPE_HELP: Record<string, string> = {
  openid: 'confirm who you are',
  profile: 'see your display name',
  email: 'see your email address',
  offline_access: 'stay signed in when you are offline (refresh)',
};

/**
 * Allow / deny screen for a third-party app using Briven as IdP.
 */
export function ConsentClient({
  projectId,
  challenge,
}: {
  projectId: string;
  challenge: string;
}) {
  const [data, setData] = useState<Challenge | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    if (!challenge) {
      setErr('missing challenge — start sign-in from the app again');
      return;
    }
    setErr(null);
    const res = await fetch(
      `/api/v1/auth-core/oidc/challenge/${encodeURIComponent(challenge)}`,
      { credentials: 'include', cache: 'no-store' },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error_description?: string;
      };
      setErr(body.error_description ?? `could not load app (${res.status})`);
      return;
    }
    setData((await res.json()) as Challenge);
  }, [challenge]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(decision: 'allow' | 'deny'): Promise<void> {
    if (!challenge) return;
    setPending(true);
    setErr(null);
    try {
      const res = await fetch('/api/v1/auth-core/oidc/consent', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challenge, decision }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        redirectUrl?: string;
        error_description?: string;
        error?: string;
      };
      if (!res.ok) {
        if (res.status === 401) {
          // Send to engine login, then back here (must set sAccessToken)
          const back = `/auth/${projectId}/oauth/consent?challenge=${encodeURIComponent(challenge)}`;
          window.location.href = `/auth/${projectId}/sign-in?callbackURL=${encodeURIComponent(back)}`;
          return;
        }
        throw new Error(body.error_description ?? body.error ?? `http ${res.status}`);
      }
      if (!body.redirectUrl) throw new Error('no redirect from server');
      window.location.href = body.redirectUrl;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'consent failed');
      setPending(false);
    }
  }

  if (err && !data) {
    return (
      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 font-mono text-sm">
        <p className="text-[var(--color-text)]">could not open consent</p>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">{err}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="font-mono text-sm text-[var(--color-text-muted)]">loading…</p>
    );
  }

  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <div className="flex items-center gap-3">
        {data.client.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.client.logoUrl}
            alt=""
            className="size-10 rounded object-contain"
          />
        ) : (
          <div
            className="flex size-10 items-center justify-center rounded font-mono text-sm text-black"
            style={{ background: '#FFFD74' }}
          >
            {data.client.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="font-mono text-lg text-[var(--color-text)]">
            allow {data.client.name}?
          </h1>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-muted)]">
            this app wants to use your Briven sign-in
          </p>
        </div>
      </div>

      <ul className="mt-6 space-y-2">
        {data.scopes.map((s) => (
          <li
            key={s}
            className="rounded border border-[var(--color-border-subtle)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
          >
            <span className="font-medium">{s}</span>
            {SCOPE_HELP[s] ? (
              <span className="ml-2 text-[var(--color-text-muted)]">
                — {SCOPE_HELP[s]}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {err ? (
        <p className="mt-4 font-mono text-xs text-red-400">{err}</p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => void decide('allow')}
          className="rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: '#FFFD74' }}
        >
          {pending ? 'working…' : 'allow'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void decide('deny')}
          className="rounded-md border border-[var(--color-border-subtle)] px-4 py-2 font-mono text-xs text-[var(--color-text-muted)] disabled:opacity-50"
        >
          deny
        </button>
      </div>
    </div>
  );
}
