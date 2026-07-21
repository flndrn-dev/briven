'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

interface DomainRow {
  id: string;
  origin: string;
  isWildcard: boolean;
}

export function AuthDomainsClient({ projects }: { projects: AuthV2ProjectRow[] }) {
  const enabled = projects.filter((p) => p.authEnabled);
  const [projectId, setProjectId] = useState(enabled[0]?.id ?? '');
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [origin, setOrigin] = useState('https://');
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setErr(null);
    const res = await fetch(`/api/v1/projects/${id}/auth/allowed-domains`, {
      credentials: 'include',
    });
    if (!res.ok) {
      setErr(`load failed (${res.status})`);
      return;
    }
    const body = (await res.json()) as { domains: DomainRow[] };
    setDomains(body.domains ?? []);
  }, []);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  async function add(): Promise<void> {
    if (!projectId || !origin.trim()) return;
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/allowed-domains`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origin: origin.trim(), isWildcard: origin.includes('*.') }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `http ${res.status}`);
      }
      setOrigin('https://');
      await load(projectId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'add failed');
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
    <div className="flex max-w-xl flex-col gap-4">
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

      <div className="flex flex-wrap gap-2">
        <input
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder="https://your-app.com"
          className="min-w-[16rem] flex-1 rounded-md border bg-[var(--color-surface)] px-3 py-2 font-mono text-xs"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => void add()}
          className="rounded-md px-3 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: '#e6b800' }}
        >
          {pending ? 'adding…' : 'add domain'}
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {domains.map((d) => (
          <li
            key={d.id}
            className="rounded-md border px-3 py-2 font-mono text-xs"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          >
            {d.origin}
            {d.isWildcard ? ' · wildcard' : ''}
          </li>
        ))}
      </ul>
      {err ? <p className="font-mono text-xs text-[var(--color-error)]">{err}</p> : null}
    </div>
  );
}
