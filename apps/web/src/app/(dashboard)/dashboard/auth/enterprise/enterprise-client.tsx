'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

/**
 * Enterprise tab: enable Auth (tenant), list tenants, honest SAML/OIDC status.
 */
export function AuthEnterpriseClient({
  projects: initial,
}: {
  projects: AuthV2ProjectRow[];
}) {
  const router = useRouter();
  const [projects, setProjects] = useState(initial);
  const [tenants, setTenants] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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
    const body = (await res.json()) as { tenantIds?: string[] };
    setTenants(body.tenantIds ?? []);
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  async function enableAuth(projectId: string): Promise<void> {
    setPendingId(projectId);
    setErr(null);
    setNote(null);
    try {
      const res = await fetch(`/api/v1/auth-core/projects/${projectId}/enable`, {
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
          ? `Auth on · tenant ${body.tenantId ?? ''}`
          : `Auth already on · tenant ${body.tenantId ?? ''}`,
      );
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId ? { ...p, authEnabled: true } : p,
        ),
      );
      await loadTenants();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'enable failed');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          projects &amp; tenants
        </h2>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          each Briven project maps to one Auth tenant on Doltgres. turn Auth on
          to create that tenant.
        </p>

        {projects.length === 0 ? (
          <p className="mt-4 font-mono text-xs text-[var(--color-text-muted)]">
            no projects yet
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {projects.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-border-subtle)] px-3 py-2 font-mono text-xs"
              >
                <span className="text-[var(--color-text)]">
                  {p.name}
                  <span className="ml-2 text-[var(--color-text-muted)]">
                    {p.authEnabled ? 'Auth on' : 'Auth off'}
                  </span>
                </span>
                {!p.authEnabled ? (
                  <button
                    type="button"
                    disabled={pendingId === p.id}
                    onClick={() => void enableAuth(p.id)}
                    className="rounded-md px-3 py-1 font-mono text-[11px] font-medium text-black disabled:opacity-50"
                    style={{ background: '#FFFD74' }}
                  >
                    {pendingId === p.id ? 'enabling…' : 'enable Auth'}
                  </button>
                ) : (
                  <span className="text-[var(--color-text-muted)]">ready</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6">
          <h3 className="font-mono text-xs text-[var(--color-text)]">
            tenants on Doltgres
          </h3>
          {tenants.length === 0 ? (
            <p className="mt-2 font-mono text-[11px] text-[var(--color-text-muted)]">
              none yet — enable Auth on a project
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2 font-mono text-[11px]">
              {tenants.map((t) => (
                <li
                  key={t}
                  className="rounded border border-[var(--color-border-subtle)] px-2 py-1 text-[var(--color-text-muted)]"
                >
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>

        {note ? (
          <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
            {note}
          </p>
        ) : null}
        {err ? (
          <p className="mt-3 font-mono text-xs text-red-400">{err}</p>
        ) : null}
      </div>

      <div className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          SAML / OIDC SSO
        </h2>
        <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          Not live yet. This tab will hold company SSO (SAML + OpenID Connect)
          and &quot;Briven as login provider for other apps&quot; later. Right now
          multitenancy (projects → tenants) and social providers are what you
          configure above and under Providers.
        </p>
        <p className="mt-3 font-mono text-[11px] text-[var(--color-text-muted)]">
          also later: machine-to-machine keys, full SuperTokens enterprise
          checklist pass
        </p>
      </div>
    </div>
  );
}
