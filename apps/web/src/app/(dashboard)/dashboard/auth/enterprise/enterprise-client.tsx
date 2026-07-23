'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

type TenantRow = {
  tenantId: string;
  projectId: string;
  createdAt: string | null;
  authEnabled: true;
};

type SsoConn = {
  id: string;
  name: string;
  providerType: 'saml' | 'oidc';
  domains: string[];
  productionReady: boolean;
  ready: boolean;
  configKeys: string[];
};

/**
 * Enterprise: real Auth-enabled status from Doltgres + SAML/OIDC SSO setup.
 */
export function AuthEnterpriseClient({
  projects: initial,
}: {
  projects: AuthV2ProjectRow[];
}) {
  const router = useRouter();
  const [projects, setProjects] = useState(initial);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [projectId, setProjectId] = useState(initial[0]?.id ?? '');
  const [connections, setConnections] = useState<SsoConn[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // create form
  const [name, setName] = useState('');
  const [providerType, setProviderType] = useState<'saml' | 'oidc'>('oidc');
  const [domains, setDomains] = useState('');
  // SAML
  const [idpSsoUrl, setIdpSsoUrl] = useState('');
  const [idpCert, setIdpCert] = useState('');
  // OIDC
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [tokenUrl, setTokenUrl] = useState('');

  const loadTenants = useCallback(async () => {
    const res = await fetch('/api/v1/auth-core/tenants', {
      credentials: 'include',
    });
    if (res.status === 401) {
      setErr('sign in to briven.tech to see tenants');
      return;
    }
    if (!res.ok) {
      setErr(`tenants load failed (${res.status})`);
      return;
    }
    const body = (await res.json()) as {
      tenants?: TenantRow[];
      tenantIds?: string[];
    };
    if (body.tenants?.length) {
      setTenants(body.tenants);
    } else {
      setTenants(
        (body.tenantIds ?? []).map((tenantId) => ({
          tenantId,
          projectId: tenantId,
          createdAt: null,
          authEnabled: true as const,
        })),
      );
    }
  }, []);

  const loadConnections = useCallback(async (id: string) => {
    if (!id) return;
    const res = await fetch(
      `/api/v1/auth-core/projects/${id}/sso/connections`,
      { credentials: 'include' },
    );
    if (!res.ok) {
      if (res.status !== 401 && res.status !== 403) {
        setErr(`sso load failed (${res.status})`);
      }
      setConnections([]);
      return;
    }
    const body = (await res.json()) as { connections?: SsoConn[] };
    setConnections(body.connections ?? []);
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  useEffect(() => {
    if (projectId) void loadConnections(projectId);
  }, [projectId, loadConnections]);

  async function enableAuth(id: string): Promise<void> {
    setPendingId(id);
    setErr(null);
    setNote(null);
    try {
      const res = await fetch(`/api/v1/auth-core/projects/${id}/enable`, {
        method: 'POST',
        credentials: 'include',
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        tenantId?: string;
        created?: boolean;
      };
      if (!res.ok || body.ok === false) {
        throw new Error(body.message ?? `http ${res.status}`);
      }
      setNote(
        body.created
          ? `Auth enabled — tenant ${body.tenantId ?? ''}`
          : `Auth already on — tenant ${body.tenantId ?? ''}`,
      );
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, authEnabled: true } : p)),
      );
      await loadTenants();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'enable failed');
    } finally {
      setPendingId(null);
    }
  }

  async function createSso(): Promise<void> {
    if (!projectId || !name.trim()) return;
    setPendingId('sso');
    setErr(null);
    setNote(null);
    try {
      const domainList = domains
        .split(/[,\s]+/)
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
      const config: Record<string, string> =
        providerType === 'saml'
          ? {
              idpSsoUrl: idpSsoUrl.trim(),
              idpCert: idpCert.trim(),
            }
          : {
              issuer: issuer.trim(),
              clientId: clientId.trim(),
              clientSecret: clientSecret.trim(),
              ...(authUrl.trim() ? { authorizationUrl: authUrl.trim() } : {}),
              ...(tokenUrl.trim() ? { tokenUrl: tokenUrl.trim() } : {}),
            };
      const res = await fetch(
        `/api/v1/auth-core/projects/${projectId}/sso/connections`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            providerType,
            domains: domainList,
            config,
            jitEnabled: true,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        connection?: SsoConn;
      };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);
      setName('');
      setDomains('');
      setIdpSsoUrl('');
      setIdpCert('');
      setIssuer('');
      setClientId('');
      setClientSecret('');
      setAuthUrl('');
      setTokenUrl('');
      const ready = body.connection?.productionReady;
      setNote(
        ready
          ? 'SSO connection production-ready — login paths are live'
          : 'SSO connection saved — add full IdP fields so productionReady turns on',
      );
      await loadConnections(projectId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed');
    } finally {
      setPendingId(null);
    }
  }

  async function removeSso(connectionId: string): Promise<void> {
    if (!projectId) return;
    setPendingId(connectionId);
    try {
      const res = await fetch(
        `/api/v1/auth-core/projects/${projectId}/sso/connections/${connectionId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error(`http ${res.status}`);
      await loadConnections(projectId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setPendingId(null);
    }
  }

  const enabledIds = new Set(tenants.map((t) => t.projectId));
  // workspace flag + live tenant row both count
  const rows = projects.map((p) => ({
    ...p,
    reallyEnabled: p.authEnabled || enabledIds.has(p.id),
    tenantFromDb: tenants.find((t) => t.projectId === p.id),
  }));

  return (
    <div className="space-y-8">
      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          Auth enabled — live check
        </h2>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          A project is Auth-enabled when it has a tenant row in Doltgres
          (be_tenants). That is what app login uses.
        </p>

        {rows.length === 0 ? (
          <p className="mt-4 font-mono text-xs text-[var(--color-text-muted)]">
            no projects yet
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left font-mono text-xs">
              <thead className="border-b border-[var(--color-border-subtle)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-2 py-2 font-normal">project</th>
                  <th className="px-2 py-2 font-normal">Auth</th>
                  <th className="px-2 py-2 font-normal">tenant</th>
                  <th className="px-2 py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--color-border-subtle)] last:border-0"
                  >
                    <td className="px-2 py-2 text-[var(--color-text)]">
                      {p.name}
                      <span className="ml-2 text-[var(--color-text-muted)]">
                        {p.slug}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      {p.reallyEnabled ? (
                        <span style={{ color: '#FFFD74' }}>enabled</span>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">
                          off
                        </span>
                      )}
                    </td>
                    <td className="max-w-[12rem] truncate px-2 py-2 text-[var(--color-text-muted)]">
                      {p.tenantFromDb?.tenantId ?? '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {!p.reallyEnabled ? (
                        <button
                          type="button"
                          disabled={pendingId === p.id}
                          onClick={() => void enableAuth(p.id)}
                          className="rounded-md px-2 py-1 font-mono text-[11px] font-medium text-black disabled:opacity-50"
                          style={{ background: '#FFFD74' }}
                        >
                          {pendingId === p.id ? '…' : 'enable'}
                        </button>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">
                          ok
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {note ? (
          <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
            {note}
          </p>
        ) : null}
        {err ? (
          <p className="mt-3 font-mono text-xs text-red-400">{err}</p>
        ) : null}
      </div>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          Company SSO (SAML + OIDC)
        </h2>
        <p className="mt-1 max-w-2xl font-mono text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          Production login paths are live on the API. A connection is marked{' '}
          <strong className="text-[var(--color-text)]">production ready</strong>{' '}
          when required IdP fields are set (SAML: SSO URL + certificate; OIDC:
          client id + secret + issuer or endpoints). Users sign in via those
          URLs; accounts land in briven-engine on Doltgres.
        </p>

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

        <div className="mt-4 space-y-2">
          {connections.length === 0 ? (
            <p className="font-mono text-xs text-[var(--color-text-muted)]">
              no SSO connections yet for this project
            </p>
          ) : (
            connections.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--color-border-subtle)] px-3 py-2 font-mono text-xs"
              >
                <div>
                  <span className="text-[var(--color-text)]">{c.name}</span>
                  <span className="ml-2 text-[var(--color-text-muted)]">
                    {c.providerType}
                  </span>
                  {c.productionReady ? (
                    <span className="ml-2" style={{ color: '#FFFD74' }}>
                      production ready
                    </span>
                  ) : (
                    <span className="ml-2 text-[var(--color-text-muted)]">
                      incomplete config
                    </span>
                  )}
                  {c.domains?.length ? (
                    <span className="ml-2 text-[var(--color-text-muted)]">
                      · {c.domains.join(', ')}
                    </span>
                  ) : null}
                  {c.productionReady ? (
                    <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                      start:{' '}
                      {c.providerType === 'saml'
                        ? `/v1/auth-core/sso/saml/${c.id}`
                        : `/v1/auth-core/sso/oidc/${c.id}`}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={pendingId === c.id}
                  onClick={() => void removeSso(c.id)}
                  className="text-[var(--color-text-muted)] underline"
                >
                  remove
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-6 space-y-3 border-t border-[var(--color-border-subtle)] pt-4">
          <p className="font-mono text-xs text-[var(--color-text)]">
            add connection
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="name (e.g. Okta)"
              className="min-w-[8rem] flex-1 rounded-md border bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
              style={{ borderColor: 'var(--auth-accent-border)' }}
            />
            <select
              value={providerType}
              onChange={(e) =>
                setProviderType(e.target.value as 'saml' | 'oidc')
              }
              className="rounded-md border bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
              style={{ borderColor: 'var(--auth-accent-border)' }}
            >
              <option value="oidc">OIDC</option>
              <option value="saml">SAML 2.0</option>
            </select>
            <input
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="email domains (acme.com)"
              className="min-w-[10rem] flex-1 rounded-md border bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
              style={{ borderColor: 'var(--auth-accent-border)' }}
            />
          </div>

          {providerType === 'saml' ? (
            <div className="space-y-2">
              <input
                value={idpSsoUrl}
                onChange={(e) => setIdpSsoUrl(e.target.value)}
                placeholder="IdP SSO URL"
                className="w-full rounded-md border bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
                style={{ borderColor: 'var(--auth-accent-border)' }}
              />
              <textarea
                value={idpCert}
                onChange={(e) => setIdpCert(e.target.value)}
                placeholder="IdP signing certificate (PEM)"
                rows={3}
                className="w-full rounded-md border bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
                style={{ borderColor: 'var(--auth-accent-border)' }}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <input
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                placeholder="Issuer URL (OpenID discovery)"
                className="w-full rounded-md border bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
                style={{ borderColor: 'var(--auth-accent-border)' }}
              />
              <div className="flex flex-wrap gap-2">
                <input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="client id"
                  className="min-w-[8rem] flex-1 rounded-md border bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
                  style={{ borderColor: 'var(--auth-accent-border)' }}
                />
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="client secret"
                  className="min-w-[8rem] flex-1 rounded-md border bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
                  style={{ borderColor: 'var(--auth-accent-border)' }}
                />
              </div>
              <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
                optional if discovery works — override authorize / token:
              </p>
              <input
                value={authUrl}
                onChange={(e) => setAuthUrl(e.target.value)}
                placeholder="authorization URL (optional)"
                className="w-full rounded-md border bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
                style={{ borderColor: 'var(--auth-accent-border)' }}
              />
              <input
                value={tokenUrl}
                onChange={(e) => setTokenUrl(e.target.value)}
                placeholder="token URL (optional)"
                className="w-full rounded-md border bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
                style={{ borderColor: 'var(--auth-accent-border)' }}
              />
            </div>
          )}

          <button
            type="button"
            disabled={pendingId === 'sso' || !name.trim()}
            onClick={() => void createSso()}
            className="rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
            style={{ background: '#FFFD74' }}
          >
            {pendingId === 'sso' ? 'saving…' : 'save SSO connection'}
          </button>
        </div>
      </div>
    </div>
  );
}
