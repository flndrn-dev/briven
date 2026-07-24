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

interface M2mClientRow {
  id: string;
  clientId: string;
  name: string;
  role: string;
  hint: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt?: string;
}

/**
 * Mint / list briven-engine SDK keys + M2M machine clients.
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

  // M2M machine clients
  const [m2mItems, setM2mItems] = useState<M2mClientRow[]>([]);
  const [m2mName, setM2mName] = useState('cron-job');
  const [m2mRole, setM2mRole] = useState<'viewer' | 'developer' | 'admin'>(
    'developer',
  );
  const [m2mCreated, setM2mCreated] = useState<{
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
  } | null>(null);
  const [m2mErr, setM2mErr] = useState<string | null>(null);
  const [m2mPending, setM2mPending] = useState(false);

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

  const loadM2m = useCallback(async (id: string) => {
    if (!id) return;
    setM2mErr(null);
    const res = await fetch(`/api/v1/auth-core/projects/${id}/m2m/clients`, {
      credentials: 'include',
    });
    if (res.status === 401) {
      setM2mErr('sign in to manage machine clients');
      return;
    }
    if (res.status === 403) {
      setM2mErr('you need admin access on this project');
      return;
    }
    if (!res.ok) {
      setM2mErr(`machine clients load failed (${res.status})`);
      return;
    }
    const body = (await res.json()) as { clients?: M2mClientRow[] };
    setM2mItems(body.clients ?? []);
  }, []);

  useEffect(() => {
    if (projectId) {
      void load(projectId);
      void loadM2m(projectId);
    }
  }, [projectId, load, loadM2m]);

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

  async function createM2m(): Promise<void> {
    if (!projectId) return;
    setM2mPending(true);
    setM2mErr(null);
    setM2mCreated(null);
    try {
      const res = await fetch(
        `/api/v1/auth-core/projects/${projectId}/m2m/clients`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: m2mName || 'cron-job', role: m2mRole }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        client?: { clientId?: string; clientSecret?: string };
        tokenUrl?: string;
        message?: string;
        code?: string;
      };
      if (!res.ok) {
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      if (!body.client?.clientId || !body.client?.clientSecret) {
        throw new Error('created but no secret returned');
      }
      setM2mCreated({
        clientId: body.client.clientId,
        clientSecret: body.client.clientSecret,
        tokenUrl:
          body.tokenUrl ??
          'https://api.briven.tech/v1/auth-core/oauth/token',
      });
      await loadM2m(projectId);
    } catch (e) {
      setM2mErr(e instanceof Error ? e.message : 'create failed');
    } finally {
      setM2mPending(false);
    }
  }

  async function revokeM2m(clientId: string): Promise<void> {
    if (!projectId) return;
    setM2mPending(true);
    setM2mErr(null);
    try {
      const res = await fetch(
        `/api/v1/auth-core/projects/${projectId}/m2m/clients/${encodeURIComponent(clientId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `http ${res.status}`);
      }
      await loadM2m(projectId);
    } catch (e) {
      setM2mErr(e instanceof Error ? e.message : 'revoke failed');
    } finally {
      setM2mPending(false);
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
    <div className="flex max-w-2xl flex-col gap-10">
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

      {/* ─── App / browser SDK keys ─── */}
      <section className="flex flex-col gap-4">
        <div>
          <h3 className="font-mono text-sm text-[var(--color-text)]">
            app keys
          </h3>
          <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
            long-lived keys for your app SDK (shown once when created).
          </p>
        </div>

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
      </section>

      {/* ─── M2M machine clients ─── */}
      <section className="flex flex-col gap-4">
        <div>
          <h3 className="font-mono text-sm text-[var(--color-text)]">
            machine clients (M2M)
          </h3>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            for robots and servers — not people. create a client id + secret,
            then exchange them for a short-lived token (about 1 hour) to call
            this project&apos;s APIs.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 font-mono text-xs">
            <span className="text-[var(--color-text-muted)]">name</span>
            <input
              value={m2mName}
              onChange={(e) => setM2mName(e.target.value)}
              className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
              style={{ borderColor: 'var(--auth-accent-border)' }}
              placeholder="cron-job"
            />
          </label>
          <label className="flex flex-col gap-1 font-mono text-xs">
            <span className="text-[var(--color-text-muted)]">power level</span>
            <select
              value={m2mRole}
              onChange={(e) =>
                setM2mRole(e.target.value as 'viewer' | 'developer' | 'admin')
              }
              className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
              style={{ borderColor: 'var(--auth-accent-border)' }}
            >
              <option value="viewer">viewer (read only)</option>
              <option value="developer">developer (read + write)</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button
            type="button"
            disabled={m2mPending}
            onClick={() => void createM2m()}
            className="rounded-md px-3 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
            style={{ background: '#FFFD74' }}
          >
            {m2mPending ? 'creating…' : 'create machine client'}
          </button>
        </div>

        {m2mCreated ? (
          <div
            className="rounded-md border p-3 font-mono text-xs space-y-2"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          >
            <p className="text-[var(--color-text-muted)]">
              copy both now — secret shown once:
            </p>
            <p className="text-[var(--color-text)]">
              <span className="text-[var(--color-text-muted)]">client_id: </span>
              <code className="break-all">{m2mCreated.clientId}</code>
            </p>
            <p className="text-[var(--color-text)]">
              <span className="text-[var(--color-text-muted)]">client_secret: </span>
              <code className="break-all">{m2mCreated.clientSecret}</code>
            </p>
            <p className="text-[var(--color-text-muted)]">
              get a token:{' '}
              <code className="text-[var(--color-text)] break-all">
                POST {m2mCreated.tokenUrl}
              </code>
              {' · '}
              grant_type=client_credentials
            </p>
          </div>
        ) : null}

        {m2mItems.length === 0 ? (
          <p className="font-mono text-xs text-[var(--color-text-muted)]">
            no machine clients yet
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {m2mItems.map((cl) => (
              <li
                key={cl.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 font-mono text-xs"
                style={{ borderColor: 'var(--auth-accent-border)' }}
              >
                <span className="text-[var(--color-text)]">
                  {cl.name} · {cl.clientId.slice(0, 16)}… · {cl.role}
                  {cl.hint ? ` · secret ${cl.hint}` : ''}
                  {cl.revokedAt ? ' · revoked' : ''}
                </span>
                {!cl.revokedAt ? (
                  <button
                    type="button"
                    disabled={m2mPending}
                    onClick={() => void revokeM2m(cl.clientId)}
                    className="text-[var(--color-text-muted)] underline disabled:opacity-50"
                  >
                    revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {m2mErr ? (
          <p className="font-mono text-xs text-red-400">{m2mErr}</p>
        ) : null}
      </section>
    </div>
  );
}
