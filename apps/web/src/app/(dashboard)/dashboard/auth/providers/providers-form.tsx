'use client';

/**
 * briven-engine — save Google/GitHub (etc.) secrets for a project.
 * Uses session cookies; shows configured state after save.
 */

import { useCallback, useEffect, useState } from 'react';

const PROVIDERS = [
  { id: 'google', name: 'Google' },
  { id: 'github', name: 'GitHub' },
  { id: 'discord', name: 'Discord' },
  { id: 'microsoft', name: 'Microsoft' },
  { id: 'apple', name: 'Apple' },
] as const;

type ProviderStatus = {
  thirdPartyId: string;
  name: string;
  configured: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
};

function apiOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN?.replace(/\/$/, '') ||
    'https://api.briven.tech'
  );
}

export function BrivenEngineProvidersForm() {
  const [projectId, setProjectId] = useState('');
  const [thirdPartyId, setThirdPartyId] = useState<string>('google');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);

  const loadConfig = useCallback(async (pid: string) => {
    if (!pid.trim()) {
      setProviders([]);
      return;
    }
    try {
      const res = await fetch(
        `${apiOrigin()}/v1/auth-core/projects/${encodeURIComponent(pid.trim())}/config`,
        { credentials: 'include', cache: 'no-store' },
      );
      if (!res.ok) {
        setProviders([]);
        return;
      }
      const body = (await res.json()) as { providers?: ProviderStatus[] };
      setProviders(body.providers ?? []);
    } catch {
      setProviders([]);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadConfig(projectId);
    }, 400);
    return () => clearTimeout(t);
  }, [projectId, loadConfig]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (!projectId.trim() || !clientId.trim() || !clientSecret.trim()) {
      setStatus('Fill project id, client id, and client secret.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `${apiOrigin()}/v1/auth-core/projects/${encodeURIComponent(projectId.trim())}/providers/${encodeURIComponent(thirdPartyId)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ clientId, clientSecret }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        engine?: string;
        config?: { providers?: ProviderStatus[] };
      };
      if (!res.ok) {
        setStatus(
          body.message ??
            `Save failed (${res.status}). Sign in as project admin.`,
        );
      } else {
        setStatus(
          `Saved ${thirdPartyId} on ${body.engine ?? 'briven-engine'} (Doltgres secrets).`,
        );
        setClientSecret('');
        if (body.config?.providers) setProviders(body.config.providers);
        else await loadConfig(projectId);
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={onSubmit}
        className="flex max-w-lg flex-col gap-3 rounded-md border p-4"
        style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
      >
        <p
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: 'var(--auth-accent, #e6b800)' }}
        >
          briven-engine · save social secrets
        </p>
        <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
          Real Google/GitHub client id + secret for this project. Stored encrypted
          (Doltgres control plane secrets). Used when users click “Sign in with…”.
        </p>
        <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
          Project id
          <input
            className="rounded border bg-transparent px-2 py-1.5 text-[var(--color-text)]"
            style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="p_…"
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
          Provider
          <select
            className="rounded border bg-transparent px-2 py-1.5 text-[var(--color-text)]"
            style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
            value={thirdPartyId}
            onChange={(e) => setThirdPartyId(e.target.value)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
          Client id
          <input
            className="rounded border bg-transparent px-2 py-1.5 text-[var(--color-text)]"
            style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
            placeholder={
              thirdPartyId === 'google'
                ? '….apps.googleusercontent.com'
                : 'OAuth app client id'
            }
          />
        </label>
        <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
          Client secret
          <input
            type="password"
            className="rounded border bg-transparent px-2 py-1.5 text-[var(--color-text)]"
            style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded px-3 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: 'var(--auth-accent, #e6b800)' }}
        >
          {busy ? 'Saving…' : 'Save to briven-engine'}
        </button>
        {status ? (
          <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
            {status}
          </p>
        ) : null}
      </form>

      {providers.length > 0 ? (
        <div
          className="max-w-lg rounded-md border p-3 font-mono text-xs"
          style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
        >
          <p className="text-[10px] uppercase text-[var(--color-text-muted)]">
            configured for this project
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {providers.map((p) => (
              <li key={p.thirdPartyId} className="text-[var(--color-text)]">
                {p.name} ·{' '}
                <span className="text-[var(--color-text-muted)]">
                  {p.configured ? 'ready' : 'not set'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function BrivenEngineSmsForm() {
  const [projectId, setProjectId] = useState('');
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (!projectId.trim() || !accountSid || !authToken || !fromNumber) {
      setStatus('Fill all SMS fields.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `${apiOrigin()}/v1/auth-core/projects/${encodeURIComponent(projectId.trim())}/delivery/sms`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ accountSid, authToken, fromNumber }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        engine?: string;
      };
      if (!res.ok) {
        setStatus(body.message ?? `Save failed (${res.status})`);
      } else {
        setStatus(`SMS secrets saved on ${body.engine ?? 'briven-engine'}.`);
        setAuthToken('');
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex max-w-lg flex-col gap-3 rounded-md border p-4"
      style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
    >
      <p
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--auth-accent, #e6b800)' }}
      >
        briven-engine · SMS (included)
      </p>
      <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
        Twilio-compatible: account SID, auth token, from number (E.164).
      </p>
      <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
        Project id
        <input
          className="rounded border bg-transparent px-2 py-1.5 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          placeholder="p_…"
        />
      </label>
      <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
        Account SID
        <input
          className="rounded border bg-transparent px-2 py-1.5 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
          value={accountSid}
          onChange={(e) => setAccountSid(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
        Auth token
        <input
          type="password"
          className="rounded border bg-transparent px-2 py-1.5 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
        From number
        <input
          className="rounded border bg-transparent px-2 py-1.5 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
          value={fromNumber}
          onChange={(e) => setFromNumber(e.target.value)}
          placeholder="+1…"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded px-3 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
        style={{ background: 'var(--auth-accent, #e6b800)' }}
      >
        {busy ? 'Saving…' : 'Save SMS to briven-engine'}
      </button>
      {status ? (
        <p className="font-mono text-[10px] text-[var(--color-text-muted)]">{status}</p>
      ) : null}
    </form>
  );
}
