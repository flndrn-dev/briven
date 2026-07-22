'use client';

/**
 * SuperTokens-style “recipes” for sign-in methods:
 *  1) Email / passwordless / passkey (core recipe)
 *  2) Third-party / social (built-in providers catalog)
 *
 * Not a port of the old project Auth provider screen — layout and language
 * follow SuperTokens ThirdParty recipe: thirdPartyId, clients[], redirect URI,
 * enable when clientId + secret are set.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { AuthV2ProjectRow, AuthV2ProviderFlags } from '../lib/auth-v2-types';

/** SuperTokens-style thirdPartyId + UI metadata (built-in catalog). */
const THIRD_PARTY_CATALOG = [
  {
    thirdPartyId: 'google',
    name: 'Google',
    help: 'console.cloud.google.com → APIs & Services → Credentials',
  },
  {
    thirdPartyId: 'github',
    name: 'GitHub',
    help: 'github.com/settings/developers → OAuth Apps',
  },
  {
    thirdPartyId: 'discord',
    name: 'Discord',
    help: 'discord.com/developers/applications',
  },
  {
    thirdPartyId: 'microsoft',
    name: 'Microsoft',
    help: 'portal.azure.com → Entra ID → App registrations',
  },
  {
    thirdPartyId: 'apple',
    name: 'Apple',
    help: 'developer.apple.com → Certificates, Identifiers & Profiles',
  },
  {
    thirdPartyId: 'twitter',
    name: 'X / Twitter',
    help: 'developer.x.com → Projects & Apps',
  },
  {
    thirdPartyId: 'linkedin',
    name: 'LinkedIn',
    help: 'linkedin.com/developers → My Apps',
  },
  {
    thirdPartyId: 'gitlab',
    name: 'GitLab',
    help: 'gitlab.com → Applications (or self-hosted)',
  },
  {
    thirdPartyId: 'bitbucket',
    name: 'Bitbucket',
    help: 'bitbucket.org → Workspace settings → OAuth consumers',
  },
  {
    thirdPartyId: 'facebook',
    name: 'Facebook',
    help: 'developers.facebook.com → My Apps',
  },
  {
    thirdPartyId: 'dropbox',
    name: 'Dropbox',
    help: 'dropbox.com/developers → App Console',
  },
  {
    thirdPartyId: 'spotify',
    name: 'Spotify',
    help: 'developer.spotify.com → Dashboard',
  },
  {
    thirdPartyId: 'konnos',
    name: 'Konnos',
    help: 'code.konnos.org → Settings → Applications',
  },
] as const;

type ThirdPartyId = (typeof THIRD_PARTY_CATALOG)[number]['thirdPartyId'];

interface OauthClientState {
  enabled: boolean;
  clientId: string;
  /** draft secret — never loaded from server (write-only) */
  secretDraft: string;
  secretSet: boolean;
}

type OauthMap = Record<ThirdPartyId, OauthClientState>;

const CORE_LABELS: { key: keyof AuthV2ProviderFlags; label: string; help: string }[] = [
  { key: 'emailPassword', label: 'email + password', help: 'classic password login' },
  {
    key: 'magicLink',
    label: 'magic link',
    help: 'one-click link in email — opens on your project URL',
  },
  { key: 'emailOtp', label: 'email code (OTP)', help: '6-digit code in email' },
  { key: 'passkey', label: 'passkey', help: 'Face ID / Touch ID / security key' },
];

function emptyOauth(): OauthMap {
  const m = {} as OauthMap;
  for (const p of THIRD_PARTY_CATALOG) {
    m[p.thirdPartyId] = {
      enabled: false,
      clientId: '',
      secretDraft: '',
      secretSet: false,
    };
  }
  return m;
}

function callbackUrl(apiOrigin: string, thirdPartyId: string): string {
  const base = (apiOrigin || 'https://api.briven.tech').replace(/\/$/, '');
  // Better Auth path under Briven tenant bridge
  return `${base}/v1/auth-tenant/callback/${thirdPartyId}`;
}

export function AuthProvidersClient({
  projects,
  apiOrigin,
}: {
  projects: AuthV2ProjectRow[];
  apiOrigin: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const fromQuery = search.get('project') ?? '';
  const enabledProjects = projects.filter((p) => p.authEnabled);

  const [projectId, setProjectId] = useState(
    fromQuery && enabledProjects.some((p) => p.id === fromQuery)
      ? fromQuery
      : (enabledProjects[0]?.id ?? ''),
  );
  const [flags, setFlags] = useState<AuthV2ProviderFlags>({
    emailPassword: true,
    magicLink: true,
    emailOtp: true,
    passkey: true,
  });
  const [oauth, setOauth] = useState<OauthMap>(() => emptyOauth());
  const [pendingCore, setPendingCore] = useState(false);
  const [pendingSocial, setPendingSocial] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setErr(null);
    setProof(null);

    const [snapRes, cfgRes] = await Promise.all([
      fetch(`/api/v1/auth-v2/projects/${id}/snapshot`, { credentials: 'include' }),
      fetch(`/api/v1/projects/${id}/auth/config`, { credentials: 'include' }),
    ]);

    if (snapRes.ok) {
      const snap = (await snapRes.json()) as { providers?: AuthV2ProviderFlags | null };
      if (snap.providers) setFlags(snap.providers);
    }

    if (!cfgRes.ok) {
      const body = (await cfgRes.json().catch(() => ({}))) as { message?: string };
      setErr(body.message ?? `could not load config (${cfgRes.status})`);
      return;
    }

    const body = (await cfgRes.json()) as {
      config?: {
        providers?: Record<string, { enabled?: boolean; clientId?: string | null }>;
      };
      secretSet?: Partial<Record<string, boolean>>;
    };

    const next = emptyOauth();
    const providers = body.config?.providers ?? {};
    const secretSet = body.secretSet ?? {};
    for (const p of THIRD_PARTY_CATALOG) {
      const row = providers[p.thirdPartyId];
      next[p.thirdPartyId] = {
        enabled: row?.enabled === true,
        clientId: typeof row?.clientId === 'string' ? row.clientId : '',
        secretDraft: '',
        secretSet: secretSet[p.thirdPartyId] === true,
      };
    }
    setOauth(next);
  }, []);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  async function saveCore(): Promise<void> {
    if (!projectId) return;
    setPendingCore(true);
    setErr(null);
    setProof(null);
    try {
      const res = await fetch(`/api/v1/auth-v2/projects/${projectId}/providers`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(flags),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        proof?: AuthV2ProviderFlags;
        providers?: AuthV2ProviderFlags;
        savedAt?: string;
      };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);
      const live = body.proof ?? body.providers;
      if (live) setFlags(live);
      setProof(
        `core recipes saved ${body.savedAt ?? 'ok'} — pwd ${live?.emailPassword ? 'ON' : 'OFF'}, magic ${live?.magicLink ? 'ON' : 'OFF'}, otp ${live?.emailOtp ? 'ON' : 'OFF'}, passkey ${live?.passkey ? 'ON' : 'OFF'}`,
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setPendingCore(false);
    }
  }

  /**
   * SuperTokens-style: save public client config (enabled + clientId) then
   * any non-empty secrets. Engine only activates a provider when both halves exist.
   */
  async function saveThirdParty(): Promise<void> {
    if (!projectId) return;
    setPendingSocial(true);
    setErr(null);
    setProof(null);
    try {
      const providersPatch: Record<string, { enabled: boolean; clientId: string | null }> = {};
      for (const p of THIRD_PARTY_CATALOG) {
        const row = oauth[p.thirdPartyId];
        providersPatch[p.thirdPartyId] = {
          enabled: row.enabled,
          clientId: row.clientId.trim() || null,
        };
      }

      const cfgRes = await fetch(`/api/v1/projects/${projectId}/auth/config`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providers: providersPatch }),
      });
      const cfgBody = (await cfgRes.json().catch(() => ({}))) as { message?: string };
      if (!cfgRes.ok) throw new Error(cfgBody.message ?? `config http ${cfgRes.status}`);

      let secretsSaved = 0;
      for (const p of THIRD_PARTY_CATALOG) {
        const draft = oauth[p.thirdPartyId].secretDraft.trim();
        if (!draft) continue;
        const sRes = await fetch(
          `/api/v1/projects/${projectId}/auth/providers/${p.thirdPartyId}/secret`,
          {
            method: 'PUT',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ secret: draft }),
          },
        );
        if (!sRes.ok) {
          const b = (await sRes.json().catch(() => ({}))) as { message?: string };
          throw new Error(
            b.message ?? `secret save failed for ${p.thirdPartyId} (${sRes.status})`,
          );
        }
        secretsSaved += 1;
      }

      await load(projectId);
      const on = THIRD_PARTY_CATALOG.filter((p) => oauth[p.thirdPartyId].enabled).map(
        (p) => p.thirdPartyId,
      );
      setProof(
        `third-party saved — enabled: ${on.length ? on.join(', ') : 'none'}` +
          (secretsSaved ? ` · ${secretsSaved} secret(s) stored (write-only)` : '') +
          ' · live config re-read',
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'third-party save failed');
    } finally {
      setPendingSocial(false);
    }
  }

  function updateOauth(id: ThirdPartyId, patch: Partial<OauthClientState>): void {
    setOauth((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function copyCallback(thirdPartyId: string): Promise<void> {
    const url = callbackUrl(apiOrigin, thirdPartyId);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(thirdPartyId);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setErr('could not copy — select the URL manually');
    }
  }

  if (enabledProjects.length === 0) {
    return (
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        no project has Auth enabled yet — open{' '}
        <a
          href="/dashboard/auth/projects"
          className="underline"
          style={{ color: 'var(--auth-accent)' }}
        >
          projects
        </a>{' '}
        and enable Auth first.
      </p>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <label className="flex flex-col gap-1 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">project (tenant)</span>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        >
          {enabledProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.slug})
            </option>
          ))}
        </select>
      </label>

      {/* ── Recipe 1: core ── */}
      <section className="flex flex-col gap-4">
        <header>
          <p
            className="font-mono text-[10px] uppercase tracking-widest"
            style={{ color: 'var(--auth-accent)' }}
          >
            recipe · email & passkeys
          </p>
          <h3 className="mt-1 font-mono text-sm text-[var(--color-text)]">
            password · passwordless · passkey
          </h3>
          <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
            SuperTokens-style core recipe. save re-reads the live engine config.
          </p>
        </header>

        <ul className="flex flex-col gap-3">
          {CORE_LABELS.map((row) => (
            <li
              key={row.key}
              className="flex items-start justify-between gap-4 rounded-md border p-3"
              style={{
                borderColor: 'var(--auth-accent-border)',
                background: 'var(--color-surface-raised)',
              }}
            >
              <div>
                <p className="font-mono text-sm text-[var(--color-text)]">{row.label}</p>
                <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                  {row.help}
                </p>
              </div>
              <Switch
                on={flags[row.key]}
                onToggle={() => setFlags((f) => ({ ...f, [row.key]: !f[row.key] }))}
              />
            </li>
          ))}
        </ul>

        <button
          type="button"
          disabled={pendingCore}
          onClick={() => void saveCore()}
          className="self-start rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: '#FFFD74' }}
        >
          {pendingCore ? 'saving…' : 'save core recipes'}
        </button>
      </section>

      {/* ── Recipe 2: ThirdParty (SuperTokens) ── */}
      <section className="flex flex-col gap-4">
        <header>
          <p
            className="font-mono text-[10px] uppercase tracking-widest"
            style={{ color: 'var(--auth-accent)' }}
          >
            recipe · thirdparty / social
          </p>
          <h3 className="mt-1 font-mono text-sm text-[var(--color-text)]">
            built-in OAuth providers
          </h3>
          <p className="mt-1 max-w-xl font-mono text-[10px] leading-relaxed text-[var(--color-text-muted)]">
            like SuperTokens ThirdParty: each provider needs a{' '}
            <strong className="text-[var(--color-text)]">client id</strong> +{' '}
            <strong className="text-[var(--color-text)]">client secret</strong>. secrets are
            write-only (never shown again). copy the callback URL into the provider console.
            the engine only turns a provider on when both halves exist.
          </p>
        </header>

        <ul className="flex flex-col gap-4">
          {THIRD_PARTY_CATALOG.map((p) => {
            const row = oauth[p.thirdPartyId];
            const cb = callbackUrl(apiOrigin, p.thirdPartyId);
            const ready = row.enabled && row.clientId.trim() && row.secretSet;
            return (
              <li
                key={p.thirdPartyId}
                className="rounded-md border p-4"
                style={{
                  borderColor: 'var(--auth-accent-border)',
                  background: 'var(--color-surface-raised)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm text-[var(--color-text)]">{p.name}</p>
                      <code className="font-mono text-[10px] text-[var(--color-text-muted)]">
                        thirdPartyId: {p.thirdPartyId}
                      </code>
                      {ready ? (
                        <span
                          className="font-mono text-[10px]"
                          style={{ color: 'var(--auth-accent)' }}
                        >
                          ready
                        </span>
                      ) : row.secretSet ? (
                        <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                          secret set
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                          needs secret
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                      {p.help}
                    </p>
                  </div>
                  <Switch
                    on={row.enabled}
                    onToggle={() => updateOauth(p.thirdPartyId, { enabled: !row.enabled })}
                  />
                </div>

                <div className="mt-3 flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--auth-accent-border)' }}>
                  <label className="flex flex-col gap-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                    clients[0].clientId
                    <input
                      type="text"
                      value={row.clientId}
                      onChange={(e) =>
                        updateOauth(p.thirdPartyId, { clientId: e.target.value })
                      }
                      placeholder="public client id from provider console"
                      className="rounded-md border bg-[var(--color-surface)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
                      style={{ borderColor: 'var(--auth-accent-border)' }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                    clients[0].clientSecret (write-only)
                    <input
                      type="password"
                      value={row.secretDraft}
                      onChange={(e) =>
                        updateOauth(p.thirdPartyId, { secretDraft: e.target.value })
                      }
                      placeholder={
                        row.secretSet
                          ? 'leave blank to keep existing secret'
                          : 'paste client secret once'
                      }
                      autoComplete="new-password"
                      className="rounded-md border bg-[var(--color-surface)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
                      style={{ borderColor: 'var(--auth-accent-border)' }}
                    />
                  </label>
                  <div className="flex flex-col gap-1 font-mono text-[10px]">
                    <span className="text-[var(--color-text-muted)]">
                      redirect / callback URI (register this in the provider console)
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <code
                        className="block min-w-0 flex-1 break-all rounded-md border px-2 py-1.5 text-[var(--color-text)]"
                        style={{
                          borderColor: 'var(--auth-accent-border)',
                          background: 'var(--color-surface)',
                        }}
                      >
                        {cb}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copyCallback(p.thirdPartyId)}
                        className="shrink-0 rounded-md border px-2 py-1.5 text-[var(--color-text-muted)]"
                        style={{ borderColor: 'var(--auth-accent-border)' }}
                      >
                        {copied === p.thirdPartyId ? 'copied' : 'copy'}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          disabled={pendingSocial}
          onClick={() => void saveThirdParty()}
          className="self-start rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: '#FFFD74' }}
        >
          {pendingSocial ? 'saving…' : 'save third-party providers'}
        </button>

        <p className="font-mono text-[10px] leading-relaxed text-[var(--color-text-muted)]">
          company SAML / OIDC (enterprise IdP) is under{' '}
          <a href="/dashboard/auth/enterprise" className="underline" style={{ color: 'var(--auth-accent)' }}>
            enterprise
          </a>
          — SuperTokens multi-tenant / enterprise path, not the social recipe above.
        </p>
      </section>

      {proof ? (
        <p className="font-mono text-xs" style={{ color: 'var(--auth-accent)' }}>
          {proof}
        </p>
      ) : null}
      {err ? <p className="font-mono text-xs text-[var(--color-error)]">{err}</p> : null}
    </div>
  );
}

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="relative h-6 w-11 shrink-0 rounded-full transition"
      style={{ background: on ? '#FFFD74' : 'var(--color-border)' }}
    >
      <span
        className="absolute top-0.5 size-5 rounded-full bg-white transition"
        style={{ left: on ? '1.35rem' : '0.15rem' }}
      />
    </button>
  );
}
