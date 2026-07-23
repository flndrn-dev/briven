'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

interface KeyRow {
  id: string;
  name: string;
  hint: string;
  scope: string;
  createdAt?: string;
  revokedAt: string | null;
}

/**
 * Mint / list briven-engine SDK keys via /v1/auth-core/projects/:id/keys
 */
export function AuthKeysClient({
  projects,
  lockProjectId,
}: {
  projects: AuthV2ProjectRow[];
  /** When set, hide project picker (per-project Auth page). */
  lockProjectId?: string;
}) {
  const [projectId, setProjectId] = useState(
    lockProjectId ?? projects[0]?.id ?? '',
  );
  const [items, setItems] = useState<KeyRow[]>([]);
  const [name, setName] = useState('browser');
  const [scope, setScope] = useState<'read' | 'read-write' | 'admin'>('read-write');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setErr(null);
    const res = await fetch(`/api/v1/auth-core/projects/${id}/keys`, {
      credentials: 'include',
    });
    if (res.status === 401) {
      setErr('sign in to briven.tech to manage keys');
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
    const body = (await res.json()) as { keys?: KeyRow[] };
    setItems(body.keys ?? []);
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
      const res = await fetch(`/api/v1/auth-core/projects/${projectId}/keys`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name || 'browser', scope }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        key?: { plaintext?: string };
        message?: string;
        code?: string;
      };
      if (!res.ok) {
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      const pk = body.key?.plaintext;
      if (!pk) throw new Error('created but no key string returned');
      setPlaintext(pk);
      await load(projectId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'mint failed');
    } finally {
      setPending(false);
    }
  }

  async function revoke(keyId: string): Promise<void> {
    if (!projectId) return;
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/v1/auth-core/projects/${projectId}/keys/${keyId}`,
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
      <div className="rounded-md border border-dashed border-[var(--color-border)] p-8 font-mono text-sm text-[var(--color-text-muted)]">
        no projects yet. create a project first, then come back for keys.
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {!lockProjectId ? (
        <label className="flex flex-col gap-1 font-mono text-xs">
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
                {p.authEnabled ? '' : ' (Auth off)'}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">key name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
        </label>
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">scope</span>
          <select
            value={scope}
            onChange={(e) =>
              setScope(e.target.value as 'read' | 'read-write' | 'admin')
            }
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          >
            <option value="read">read</option>
            <option value="read-write">read-write</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() => void mint()}
          className="rounded-md px-3 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: '#FFFD74' }}
        >
          {pending ? 'minting…' : 'mint key'}
        </button>
      </div>

      {plaintext ? (
        <div
          className="rounded-md border p-3 font-mono text-xs"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        >
          <p className="text-[var(--color-text-muted)]">copy now — shown once:</p>
          <code className="mt-1 block break-all text-[var(--color-text)]">
            {plaintext}
          </code>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          no keys for this project yet
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 font-mono text-xs"
              style={{ borderColor: 'var(--auth-accent-border)' }}
            >
              <span className="text-[var(--color-text)]">
                {k.name} · {k.hint} · {k.scope}
                {k.revokedAt ? ' · revoked' : ''}
              </span>
              {!k.revokedAt ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void revoke(k.id)}
                  className="text-[var(--color-text-muted)] underline disabled:opacity-50"
                >
                  revoke
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {err ? (
        <p className="font-mono text-xs text-red-400">{err}</p>
      ) : null}
    </div>
  );
}
