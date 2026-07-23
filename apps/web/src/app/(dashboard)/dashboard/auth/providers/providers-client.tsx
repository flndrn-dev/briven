'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

type ProviderRow = {
  thirdPartyId: string;
  name: string;
  configured: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
};

type ProjectConfig = {
  projectId: string;
  tenantId: string;
  providers: ProviderRow[];
  recipes: {
    emailPassword: boolean;
    passwordless: boolean;
    passwordlessSms: boolean;
    thirdParty: boolean;
    webauthn: boolean;
    mfa: boolean;
  };
  delivery: {
    sms: { configured: boolean };
    email: { configured: boolean };
  };
};

/**
 * Configure per-project social providers (client id + secret encrypted at rest).
 */
export function AuthProvidersClient({
  projects,
  platformMethods,
  lockProjectId,
}: {
  projects: AuthV2ProjectRow[];
  platformMethods: string[];
  lockProjectId?: string;
}) {
  const [projectId, setProjectId] = useState(
    lockProjectId ?? projects[0]?.id ?? '',
  );
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [pick, setPick] = useState('google');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setErr(null);
    const res = await fetch(`/api/v1/auth-core/projects/${id}/config`, {
      credentials: 'include',
    });
    if (res.status === 401) {
      setErr('sign in to briven.tech to manage providers');
      setConfig(null);
      return;
    }
    if (res.status === 403) {
      setErr('you need admin access on this project');
      setConfig(null);
      return;
    }
    if (!res.ok) {
      setErr(`load failed (${res.status})`);
      setConfig(null);
      return;
    }
    setConfig((await res.json()) as ProjectConfig);
  }, []);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  async function save(): Promise<void> {
    if (!projectId || !clientId.trim() || !clientSecret.trim()) return;
    setPending(true);
    setErr(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/v1/auth-core/projects/${projectId}/providers/${pick}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        config?: ProjectConfig;
      };
      if (!res.ok) {
        throw new Error(body.message ?? `http ${res.status}`);
      }
      setClientId('');
      setClientSecret('');
      setOkMsg(`${pick} saved (secrets stay encrypted)`);
      if (body.config) setConfig(body.config);
      else await load(projectId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setPending(false);
    }
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--color-border)] p-8 font-mono text-sm text-[var(--color-text-muted)]">
        no projects yet. create a project first.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          platform methods (live)
        </h2>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          what the engine reports as ready (includes Google/GitHub when env secrets
          are set on the server)
        </p>
        {platformMethods.length === 0 ? (
          <p className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
            none reported
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {platformMethods.map((m) => (
              <li
                key={m}
                className="rounded border px-2 py-1 font-mono text-[11px] text-[var(--color-text)]"
                style={{
                  borderColor: 'var(--auth-accent-border)',
                  background: 'var(--auth-accent-soft)',
                }}
              >
                {m}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          project social secrets
        </h2>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          store client id + secret per project (encrypted). apps use these for
          Google/GitHub/etc.
        </p>

        {!lockProjectId ? (
          <label className="mt-4 flex max-w-md flex-col gap-1 font-mono text-xs">
            <span className="text-[var(--color-text-muted)]">project</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="rounded-md border bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)]"
              style={{ borderColor: 'var(--auth-accent-border)' }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {config ? (
          <>
            <p className="mt-3 font-mono text-[11px] text-[var(--color-text-muted)]">
              tenant {config.tenantId}
            </p>
            <ul className="mt-3 space-y-1 font-mono text-xs">
              {config.providers.map((p) => (
                <li key={p.thirdPartyId} className="text-[var(--color-text)]">
                  {p.name}
                  <span className="ml-2 text-[var(--color-text-muted)]">
                    {p.configured
                      ? 'configured'
                      : p.hasClientId || p.hasClientSecret
                        ? 'partial'
                        : 'not set'}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex flex-col gap-1 font-mono text-xs">
                <span className="text-[var(--color-text-muted)]">provider</span>
                <select
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                  className="rounded-md border bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)]"
                  style={{ borderColor: 'var(--auth-accent-border)' }}
                >
                  {(config.providers.length
                    ? config.providers
                    : [{ thirdPartyId: 'google', name: 'Google' }]
                  ).map((p) => (
                    <option key={p.thirdPartyId} value={p.thirdPartyId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[10rem] flex-1 flex-col gap-1 font-mono text-xs">
                <span className="text-[var(--color-text-muted)]">client id</span>
                <input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  autoComplete="off"
                  className="rounded-md border bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)]"
                  style={{ borderColor: 'var(--auth-accent-border)' }}
                />
              </label>
              <label className="flex min-w-[10rem] flex-1 flex-col gap-1 font-mono text-xs">
                <span className="text-[var(--color-text-muted)]">client secret</span>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  autoComplete="new-password"
                  className="rounded-md border bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)]"
                  style={{ borderColor: 'var(--auth-accent-border)' }}
                />
              </label>
              <button
                type="button"
                disabled={pending || !clientId.trim() || !clientSecret.trim()}
                onClick={() => void save()}
                className="rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
                style={{ background: '#FFFD74' }}
              >
                {pending ? 'saving…' : 'save'}
              </button>
            </div>
          </>
        ) : null}

        {err ? (
          <p className="mt-3 font-mono text-xs text-red-400">{err}</p>
        ) : null}
        {okMsg ? (
          <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
            {okMsg}
          </p>
        ) : null}
      </div>
    </div>
  );
}
