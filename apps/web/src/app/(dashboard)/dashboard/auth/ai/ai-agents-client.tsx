'use client';

import { useCallback, useEffect, useState } from 'react';

type AgentRow = {
  id: string;
  agentName: string;
  scopes: string[];
  hint: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

export function AuthAiAgentsClient({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<AgentRow[]>([]);
  const [name, setName] = useState('support-bot');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setErr(null);
    const res = await fetch(
      `/api/v1/auth-core/projects/${encodeURIComponent(projectId)}/ai/agents`,
      { credentials: 'include', cache: 'no-store' },
    );
    if (!res.ok) {
      setErr(res.status === 401 ? 'sign in required' : `load failed (${res.status})`);
      return;
    }
    const body = (await res.json()) as { agents?: AgentRow[] };
    setItems(body.agents ?? []);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(): Promise<void> {
    setPending(true);
    setErr(null);
    setPlaintext(null);
    try {
      const res = await fetch(
        `/api/v1/auth-core/projects/${encodeURIComponent(projectId)}/ai/agents`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agentName: name || 'agent', ttlHours: 24 }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        plaintext?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);
      setPlaintext(body.plaintext ?? null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed');
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string): Promise<void> {
    setPending(true);
    try {
      await fetch(
        `/api/v1/auth-core/projects/${encodeURIComponent(projectId)}/ai/agents/${encodeURIComponent(id)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      await load();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="font-mono text-xs text-[var(--color-text-muted)] leading-relaxed">
        Tokens for AI agents and tools (not humans). Call{' '}
        <code className="text-[var(--color-text)]">GET /v1/auth-core/ai/me</code> with{' '}
        <code className="text-[var(--color-text)]">Authorization: Bearer brai_…</code>.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">agent name</span>
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
          onClick={() => void create()}
          className="rounded-md px-3 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: '#FFFD74' }}
        >
          {pending ? 'creating…' : 'create agent token'}
        </button>
      </div>
      {plaintext ? (
        <div
          className="rounded-md border p-3 font-mono text-xs"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        >
          <p className="text-[var(--color-text-muted)]">copy once:</p>
          <code className="mt-1 block break-all text-[var(--color-text)]">
            {plaintext}
          </code>
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {items.map((a) => (
          <li
            key={a.id}
            className="flex justify-between gap-2 rounded-md border px-3 py-2 font-mono text-xs"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          >
            <span className="text-[var(--color-text)]">
              {a.agentName} · {a.hint}
              {a.revokedAt ? ' · revoked' : ''}
            </span>
            {!a.revokedAt ? (
              <button
                type="button"
                className="underline text-[var(--color-text-muted)]"
                onClick={() => void revoke(a.id)}
              >
                revoke
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {err ? <p className="font-mono text-xs text-red-400">{err}</p> : null}
    </div>
  );
}
