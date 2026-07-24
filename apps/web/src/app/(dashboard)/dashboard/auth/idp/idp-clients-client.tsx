'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

type ClientRow = {
  id: string;
  clientId: string;
  name: string;
  logoUrl: string | null;
  isPublic: boolean;
  redirectUris: string[];
  scopes: string[];
  hint: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/**
 * Production IdP client registry — apps that use Briven as login office.
 */
export function AuthIdpClientsClient({
  projects,
  lockProjectId,
}: {
  projects: AuthV2ProjectRow[];
  lockProjectId?: string;
}) {
  const [projectId, setProjectId] = useState(
    lockProjectId ?? projects[0]?.id ?? '',
  );
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [issuer, setIssuer] = useState('');
  const [discovery, setDiscovery] = useState('');
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [redirectUris, setRedirectUris] = useState('https://localhost:3000/callback');
  const [isPublic, setIsPublic] = useState(false);
  const [created, setCreated] = useState<{
    clientId: string;
    clientSecret: string | null;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setErr(null);
    const res = await fetch(
      `/api/v1/auth-core/projects/${encodeURIComponent(id)}/oidc/clients`,
      { credentials: 'include', cache: 'no-store' },
    );
    if (res.status === 401) {
      setErr('sign in to briven.tech to manage IdP clients');
      return;
    }
    if (res.status === 403) {
      setErr('you need admin access on this project');
      return;
    }
    if (!res.ok) {
      setErr(`load failed (${res.status})`);
      return;
    }
    const body = (await res.json()) as {
      clients?: ClientRow[];
      issuer?: string;
      discovery?: string;
    };
    setClients(body.clients ?? []);
    setIssuer(body.issuer ?? '');
    setDiscovery(body.discovery ?? '');
  }, []);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  async function create(): Promise<void> {
    if (!projectId) return;
    setPending(true);
    setErr(null);
    setCreated(null);
    try {
      const uris = redirectUris
        .split(/[\n,]+/)
        .map((u) => u.trim())
        .filter(Boolean);
      const res = await fetch(
        `/api/v1/auth-core/projects/${encodeURIComponent(projectId)}/oidc/clients`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: name || 'My app',
            redirectUris: uris,
            logoUrl: logoUrl || undefined,
            isPublic,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        client?: { clientId?: string; clientSecret?: string | null };
        message?: string;
      };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);
      if (!body.client?.clientId) throw new Error('no client id returned');
      setCreated({
        clientId: body.client.clientId,
        clientSecret: body.client.clientSecret ?? null,
      });
      setName('');
      await load(projectId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed');
    } finally {
      setPending(false);
    }
  }

  async function revoke(clientId: string): Promise<void> {
    if (!projectId) return;
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/v1/auth-core/projects/${encodeURIComponent(projectId)}/oidc/clients/${encodeURIComponent(clientId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `http ${res.status}`);
      }
      await load(projectId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'revoke failed');
    } finally {
      setPending(false);
    }
  }

  if (projects.length === 0) {
    return (
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        no projects yet
      </p>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {!lockProjectId ? (
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">project</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2"
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

      {issuer ? (
        <div className="rounded-md border border-[var(--color-border-subtle)] p-3 font-mono text-[11px] text-[var(--color-text-muted)]">
          <p>
            issuer:{' '}
            <code className="break-all text-[var(--color-text)]">{issuer}</code>
          </p>
          <p className="mt-1">
            discovery:{' '}
            <code className="break-all text-[var(--color-text)]">{discovery}</code>
          </p>
          <p className="mt-2">
            outside apps use the standard OpenID Connect flow against these URLs.
          </p>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-sm text-[var(--color-text)]">
          register an app
        </h3>
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">app name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Dashboard"
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
        </label>
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">
            logo URL (https, optional)
          </span>
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://…"
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
        </label>
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">
            redirect URIs (one per line)
          </span>
          <textarea
            value={redirectUris}
            onChange={(e) => setRedirectUris(e.target.value)}
            rows={3}
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
        </label>
        <label className="flex items-center gap-2 font-mono text-xs text-[var(--color-text)]">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          public client (SPA / mobile — PKCE required, no secret)
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() => void create()}
          className="self-start rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: '#FFFD74' }}
        >
          {pending ? 'creating…' : 'create IdP client'}
        </button>
      </section>

      {created ? (
        <div
          className="rounded-md border p-3 font-mono text-xs space-y-2"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        >
          <p className="text-[var(--color-text-muted)]">copy now:</p>
          <p>
            client_id:{' '}
            <code className="break-all text-[var(--color-text)]">
              {created.clientId}
            </code>
          </p>
          {created.clientSecret ? (
            <p>
              client_secret:{' '}
              <code className="break-all text-[var(--color-text)]">
                {created.clientSecret}
              </code>
            </p>
          ) : (
            <p className="text-[var(--color-text-muted)]">
              public client — use PKCE (S256), no secret
            </p>
          )}
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-sm text-[var(--color-text)]">
          registered apps
        </h3>
        {clients.length === 0 ? (
          <p className="font-mono text-xs text-[var(--color-text-muted)]">
            none yet
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {clients.map((cl) => (
              <li
                key={cl.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 font-mono text-xs"
                style={{ borderColor: 'var(--auth-accent-border)' }}
              >
                <span className="text-[var(--color-text)]">
                  {cl.name}
                  {cl.isPublic ? ' · public' : ' · confidential'}
                  {cl.revokedAt ? ' · revoked' : ''}
                  <br />
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {cl.clientId}
                  </span>
                </span>
                {!cl.revokedAt ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void revoke(cl.clientId)}
                    className="text-[var(--color-text-muted)] underline disabled:opacity-50"
                  >
                    revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {err ? (
        <p className="font-mono text-xs text-red-400">{err}</p>
      ) : null}
    </div>
  );
}
