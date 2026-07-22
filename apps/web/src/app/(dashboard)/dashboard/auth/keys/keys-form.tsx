'use client';

import { useState } from 'react';

export function BrivenEngineKeysForm() {
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('app key');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setPlaintext(null);
    if (!projectId.trim()) {
      setStatus('Project id required.');
      return;
    }
    setBusy(true);
    try {
      const origin =
        process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN?.replace(/\/$/, '') ||
        'https://api.briven.tech';
      const res = await fetch(
        `${origin}/v1/auth-core/projects/${encodeURIComponent(projectId.trim())}/keys`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        key?: { plaintext?: string; hint?: string };
        message?: string;
        note?: string;
      };
      if (!res.ok) {
        setStatus(body.message ?? `Create failed (${res.status})`);
      } else {
        setPlaintext(body.key?.plaintext ?? null);
        setStatus(body.note ?? 'Key created. Copy it now.');
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onCreate}
      className="flex max-w-lg flex-col gap-3 rounded-md border p-4"
      style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
    >
      <p className="font-mono text-sm text-[var(--color-text)]">create API key</p>
      <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
        Project id
        <input
          className="rounded border bg-transparent px-2 py-1.5 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          placeholder="p_…"
        />
      </label>
      <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
        Key name
        <input
          className="rounded border bg-transparent px-2 py-1.5 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded px-3 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
        style={{ background: 'var(--auth-accent, #e6b800)' }}
      >
        {busy ? 'Creating…' : 'Create key'}
      </button>
      {status ? (
        <p className="font-mono text-[10px] text-[var(--color-text-muted)]">{status}</p>
      ) : null}
      {plaintext ? (
        <div
          className="break-all rounded border p-2 font-mono text-[11px] text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
        >
          {plaintext}
        </div>
      ) : null}
    </form>
  );
}
