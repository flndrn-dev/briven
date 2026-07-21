'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
  scope: string;
  revokedAt: string | null;
}

export function AuthKeysClient({ projects }: { projects: AuthV2ProjectRow[] }) {
  const enabled = projects.filter((p) => p.authEnabled);
  const [projectId, setProjectId] = useState(enabled[0]?.id ?? '');
  const [items, setItems] = useState<KeyRow[]>([]);
  const [name, setName] = useState('browser');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setErr(null);
    const res = await fetch(`/api/v1/projects/${id}/auth/api-keys`, { credentials: 'include' });
    if (!res.ok) {
      setErr(`load failed (${res.status})`);
      return;
    }
    const body = (await res.json()) as { items: KeyRow[] };
    setItems(body.items ?? []);
  }, []);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  async function mint(): Promise<void> {
    if (!projectId) return;
    setPending(true);
    setErr(null);
    setPlaintext(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/api-keys`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name || 'browser', scope: 'read-write' }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        key?: { id?: string } | string;
        plaintext?: string;
        token?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);
      // API returns { plaintext, key: { id, prefix, ... } } — never treat key object as string
      const pk =
        typeof body.plaintext === 'string'
          ? body.plaintext
          : typeof body.token === 'string'
            ? body.token
            : typeof body.key === 'string'
              ? body.key
              : null;
      if (!pk) throw new Error('mint succeeded but no key string returned');
      setPlaintext(pk);
      await load(projectId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'mint failed');
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

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">key name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() => void mint()}
          className="rounded-md px-3 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: '#e6b800' }}
        >
          {pending ? 'minting…' : 'mint pk_briven_auth_…'}
        </button>
      </div>

      {plaintext ? (
        <div
          className="rounded-md border p-3 font-mono text-xs"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        >
          <p className="text-[var(--color-text-muted)]">copy now — shown once:</p>
          <code className="mt-1 block break-all text-[var(--color-text)]">{plaintext}</code>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {items.map((k) => (
          <li
            key={k.id}
            className="rounded-md border px-3 py-2 font-mono text-xs"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          >
            {k.name} · {k.prefix}…{k.suffix} · {k.scope}
            {k.revokedAt ? ' · revoked' : ''}
          </li>
        ))}
      </ul>
      {err ? <p className="font-mono text-xs text-[var(--color-error)]">{err}</p> : null}
    </div>
  );
}
