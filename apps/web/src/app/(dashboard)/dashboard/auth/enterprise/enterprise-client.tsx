'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

interface SsoConnection {
  id: string;
  name: string;
  providerType: 'saml' | 'oidc';
  domains: string[];
  jitEnabled: boolean;
  deactivatedAt: string | null;
  createdAt: string;
}

export function AuthEnterpriseClient({ projects }: { projects: AuthV2ProjectRow[] }) {
  const enabled = projects.filter((p) => p.authEnabled);
  const [projectId, setProjectId] = useState(enabled[0]?.id ?? '');
  const [items, setItems] = useState<SsoConnection[]>([]);
  const [name, setName] = useState('');
  const [providerType, setProviderType] = useState<'saml' | 'oidc'>('saml');
  const [domains, setDomains] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setErr(null);
    const res = await fetch(`/api/v1/projects/${id}/auth/sso/connections`, {
      credentials: 'include',
    });
    if (!res.ok) {
      setErr(`load failed (${res.status})`);
      return;
    }
    const body = (await res.json()) as { connections?: SsoConnection[] };
    setItems(body.connections ?? []);
  }, []);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  async function create(): Promise<void> {
    if (!projectId || !name.trim()) return;
    setPending(true);
    setErr(null);
    setNote(null);
    try {
      const domainList = domains
        .split(/[,\s]+/)
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
      const res = await fetch(`/api/v1/projects/${projectId}/auth/sso/connections`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          providerType,
          domains: domainList,
          jitEnabled: true,
          config: {},
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
      if (!res.ok) throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      setName('');
      setDomains('');
      setNote(
        'SSO connection created. Add identity provider details next if needed.',
      );
      await load(projectId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed');
    } finally {
      setPending(false);
    }
  }

  if (enabled.length === 0) {
    return (
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        enable Auth on a project first.
      </p>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <label className="flex flex-col gap-1 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">project</span>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        >
          {enabled.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <p className="font-mono text-[10px] leading-relaxed text-[var(--color-text-muted)]">
        enterprise SSO (SAML / OIDC). each active connection is metered for billing (per-connection
        pricing). SCIM and compliance packs are also available via API.
      </p>

      <div
        className="flex flex-col gap-2 rounded-md border p-3"
        style={{ borderColor: 'var(--auth-accent-border)' }}
      >
        <p className="font-mono text-xs text-[var(--color-text)]">add connection</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name (e.g. Okta production)"
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2 font-mono text-xs"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        />
        <select
          value={providerType}
          onChange={(e) => setProviderType(e.target.value as 'saml' | 'oidc')}
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2 font-mono text-xs"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        >
          <option value="saml">SAML 2.0</option>
          <option value="oidc">OIDC enterprise</option>
        </select>
        <input
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          placeholder="email domains (comma-separated, e.g. acme.com)"
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2 font-mono text-xs"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        />
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={() => void create()}
          className="self-start rounded-md px-3 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: '#e6b800' }}
        >
          {pending ? 'creating…' : 'create connection'}
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {items.length === 0 ? (
          <li className="font-mono text-xs text-[var(--color-text-muted)]">no SSO connections yet</li>
        ) : (
          items.map((c) => (
            <li
              key={c.id}
              className="rounded-md border px-3 py-2 font-mono text-xs"
              style={{ borderColor: 'var(--auth-accent-border)' }}
            >
              <span className="text-[var(--color-text)]">
                {c.name} · {c.providerType.toUpperCase()}
                {c.deactivatedAt ? ' · off' : ' · active'}
              </span>
              <span className="mt-0.5 block text-[10px] text-[var(--color-text-muted)]">
                {c.domains.length ? c.domains.join(', ') : 'no domains'} · jit{' '}
                {c.jitEnabled ? 'on' : 'off'} · {c.id}
              </span>
            </li>
          ))
        )}
      </ul>

      {note ? (
        <p className="font-mono text-xs" style={{ color: 'var(--auth-accent)' }}>
          {note}
        </p>
      ) : null}
      {err ? <p className="font-mono text-xs text-[var(--color-error)]">{err}</p> : null}
    </div>
  );
}
