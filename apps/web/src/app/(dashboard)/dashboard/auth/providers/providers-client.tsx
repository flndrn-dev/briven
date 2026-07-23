'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

type ProviderRow = {
  thirdPartyId: string;
  name: string;
  configured: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  help?: string;
  callbackHint?: string;
};

type MethodFlags = {
  emailPassword: boolean;
  passwordlessEmail: boolean;
  magicLink: boolean;
  passwordlessSms: boolean;
  passkeys: boolean;
  mfa: boolean;
};

type ProjectConfig = {
  projectId: string;
  tenantId: string;
  providers: ProviderRow[];
  methods?: MethodFlags;
  delivery: {
    sms: { configured: boolean };
    email: { configured: boolean };
  };
};

const CORE_METHODS: Array<{
  key: keyof MethodFlags;
  label: string;
  help: string;
}> = [
  {
    key: 'emailPassword',
    label: 'email + password',
    help: 'Classic email and password sign-in.',
  },
  {
    key: 'passwordlessEmail',
    label: 'passwordless-email',
    help: 'One-time code by email (mittera / SMTP).',
  },
  {
    key: 'magicLink',
    label: 'magic-link',
    help: 'Magic link by email — same mail path as OTP.',
  },
  {
    key: 'passwordlessSms',
    label: 'passwordless-sms',
    help: 'SMS one-time code (needs Twilio-style secrets later).',
  },
  {
    key: 'passkeys',
    label: 'passkeys',
    help: 'WebAuthn passkeys — no client secret.',
  },
  {
    key: 'mfa',
    label: 'mfa (TOTP)',
    help: 'Authenticator app after password when enrolled.',
  },
];

/**
 * Providers section = manage ALL authentication ways for this project:
 * core methods (on/off) + OAuth (Konnos, Google, GitHub…) with secrets.
 */
export function AuthProvidersClient({
  projects,
  platformMethods: _platformMethods,
  lockProjectId,
}: {
  projects: AuthV2ProjectRow[];
  platformMethods: string[];
  lockProjectId?: string;
}) {
  const search = useSearchParams();
  const initialProvider = search.get('provider') ?? 'konnos';

  const [projectId, setProjectId] = useState(
    lockProjectId ?? projects[0]?.id ?? '',
  );
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [methods, setMethods] = useState<MethodFlags | null>(null);
  const [pick, setPick] = useState(initialProvider);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [methodPending, setMethodPending] = useState<string | null>(null);

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
    const body = (await res.json()) as ProjectConfig;
    setConfig(body);
    if (body.methods) setMethods(body.methods);
    // Keep current pick if still valid — do NOT force-reset to Konnos on every load
    // (that bug made other OAuth chips unselectable).
    const ids = body.providers?.map((p) => p.thirdPartyId) ?? [];
    setPick((prev) => {
      if (prev && ids.includes(prev)) return prev;
      if (initialProvider && ids.includes(initialProvider)) return initialProvider;
      return ids[0] ?? 'konnos';
    });
  }, [initialProvider]);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  const selected = useMemo(
    () => config?.providers.find((p) => p.thirdPartyId === pick) ?? null,
    [config, pick],
  );

  const apiOrigin =
    typeof window !== 'undefined'
      ? (() => {
          const h = window.location.hostname;
          if (h === 'briven.tech' || h === 'www.briven.tech') {
            return 'https://api.briven.tech';
          }
          if (h.includes('localhost')) return 'http://localhost:3001';
          return window.location.origin;
        })()
      : 'https://api.briven.tech';

  const callbackUrl = useMemo(() => {
    if (selected?.callbackHint) {
      return selected.callbackHint
        .replace('{apiOrigin}', apiOrigin)
        .replace('{projectId}', projectId)
        .replace(
          /^(Redirect URI: |Authorized redirect: |Authorization callback URL: )/i,
          '',
        );
    }
    return `${apiOrigin}/v1/auth-core/oauth/${pick}/callback`;
  }, [selected, apiOrigin, pick, projectId]);

  async function toggleMethod(key: keyof MethodFlags): Promise<void> {
    if (!projectId || !methods) return;
    const next = !methods[key];
    setMethodPending(key);
    setErr(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/v1/auth-core/projects/${projectId}/methods`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [key]: next }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        methods?: MethodFlags;
      };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);
      if (body.methods) setMethods(body.methods);
      else setMethods((m) => (m ? { ...m, [key]: next } : m));
      setOkMsg(`${key} ${next ? 'on' : 'off'} for this project`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not update method');
    } finally {
      setMethodPending(null);
    }
  }

  async function saveOauth(): Promise<void> {
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
      if (body.config) {
        setConfig(body.config);
        if (body.config.methods) setMethods(body.config.methods);
      } else await load(projectId);
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
      {!lockProjectId ? (
        <label className="flex max-w-md flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">project</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
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

      {/* ── Sign-in methods for this project ── */}
      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          sign-in methods
        </h2>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          turn on only what this app should use. yellow = on for this project.
        </p>

        {methods ? (
          <ul className="mt-4 space-y-2">
            {CORE_METHODS.map((m) => {
              const on = Boolean(methods[m.key]);
              return (
                <li
                  key={m.key}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-border-subtle)] px-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-[var(--color-text)]">
                      {m.label}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                      {m.help}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={methodPending === m.key}
                    onClick={() => void toggleMethod(m.key)}
                    className="shrink-0 rounded-md px-3 py-1.5 font-mono text-[11px] font-medium disabled:opacity-50"
                    style={
                      on
                        ? { background: '#FFFD74', color: '#111' }
                        : {
                            border: '1px solid var(--color-border-subtle)',
                            color: 'var(--color-text-muted)',
                          }
                    }
                  >
                    {methodPending === m.key
                      ? '…'
                      : on
                        ? 'on'
                        : 'off'}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
            loading methods…
          </p>
        )}
      </div>

      {/* ── OAuth providers ── */}
      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          OAuth providers
        </h2>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          Many can be on at once. Yellow = secrets saved (on). Click a chip to
          open that provider&apos;s setup form — others stay on.
        </p>

        {config ? (
          <>
            <p className="mt-3 font-mono text-[11px] text-[var(--color-text-muted)]">
              tenant {config.tenantId}
              {config.providers.some((p) => p.configured)
                ? ` · on: ${config.providers
                    .filter((p) => p.configured)
                    .map((p) => p.name)
                    .join(', ')}`
                : ' · none set yet'}
            </p>

            <ul className="mt-3 flex flex-wrap gap-2">
              {config.providers.map((p) => {
                const isEditing = pick === p.thirdPartyId;
                const isOn = p.configured;
                return (
                  <li key={p.thirdPartyId}>
                    <button
                      type="button"
                      title={
                        isOn
                          ? `${p.name} is on — click to edit secrets`
                          : `${p.name} not set — click to add client id + secret`
                      }
                      onClick={() => {
                        setPick(p.thirdPartyId);
                        setClientId('');
                        setClientSecret('');
                        setOkMsg(null);
                        setErr(null);
                      }}
                      className="rounded border px-2.5 py-1.5 font-mono text-[11px] outline-none focus:outline-none"
                      style={
                        isOn
                          ? {
                              // All configured OAuths stay butter yellow (multi-on)
                              borderColor: '#FFFD74',
                              background: '#FFFD74',
                              color: '#111',
                              // Editing chip: extra ring so you know which form is open
                              boxShadow: isEditing
                                ? '0 0 0 2px #111, 0 0 0 4px #FFFD74'
                                : undefined,
                            }
                          : {
                              borderColor: isEditing
                                ? '#FFFD74'
                                : 'var(--color-border-subtle)',
                              background: isEditing
                                ? 'color-mix(in srgb, #FFFD74 14%, transparent)'
                                : 'transparent',
                              color: 'var(--color-text-muted)',
                            }
                      }
                    >
                      {p.name}
                      {isOn ? ' · on' : ' · set up'}
                      {isEditing ? ' · editing' : ''}
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Credential form for the provider you're editing (others stay on) */}
            <div
              key={pick}
              className="mt-5 space-y-3 rounded-md border p-4"
              style={{ borderColor: 'var(--auth-accent-border, #FFFD74)' }}
            >
              <p className="font-mono text-xs text-[var(--color-text)]">
                {selected?.name ?? pick} — client id &amp; secret
                {selected?.configured ? (
                  <span className="ml-2 text-[var(--color-text-muted)]">
                    (on for this project)
                  </span>
                ) : null}
              </p>
              {selected?.help ? (
                <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
                  {selected.help}
                </p>
              ) : null}

              <label className="flex flex-col gap-1 font-mono text-xs">
                <span className="text-[var(--color-text-muted)]">
                  redirect / callback URL (copy into provider console)
                </span>
                <code className="break-all rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2 text-[11px] text-[var(--color-text)]">
                  {callbackUrl}
                </code>
              </label>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                <label className="flex min-w-[10rem] flex-1 flex-col gap-1 font-mono text-xs">
                  <span className="text-[var(--color-text-muted)]">
                    client id
                  </span>
                  <input
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    autoComplete="off"
                    placeholder={
                      selected?.hasClientId
                        ? '•••• set — paste new to replace'
                        : `paste ${selected?.name ?? pick} client id`
                    }
                    className="rounded-md border bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] outline-none focus:outline-none"
                    style={{ borderColor: 'var(--auth-accent-border, #FFFD74)' }}
                  />
                </label>
                <label className="flex min-w-[10rem] flex-1 flex-col gap-1 font-mono text-xs">
                  <span className="text-[var(--color-text-muted)]">
                    client secret
                  </span>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    autoComplete="new-password"
                    placeholder={
                      selected?.hasClientSecret
                        ? '•••• set — paste new to replace'
                        : `paste ${selected?.name ?? pick} client secret`
                    }
                    className="rounded-md border bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] outline-none focus:outline-none"
                    style={{ borderColor: 'var(--auth-accent-border, #FFFD74)' }}
                  />
                </label>
                <button
                  type="button"
                  disabled={pending || !clientId.trim() || !clientSecret.trim()}
                  onClick={() => void saveOauth()}
                  className="rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
                  style={{ background: '#FFFD74' }}
                >
                  {pending ? 'saving…' : `save ${selected?.name ?? pick}`}
                </button>
              </div>
              {selected?.configured ? (
                <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
                  {selected.name} is configured for this project
                </p>
              ) : (
                <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
                  not set yet — paste secrets from the {selected?.name ?? pick}{' '}
                  developer console
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
            loading providers…
          </p>
        )}
      </div>

      {err ? (
        <p className="font-mono text-xs text-red-400">{err}</p>
      ) : null}
      {okMsg ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          {okMsg}
        </p>
      ) : null}
    </div>
  );
}
