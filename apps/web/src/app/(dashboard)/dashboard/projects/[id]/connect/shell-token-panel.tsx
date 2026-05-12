'use client';

import { useState } from 'react';

interface IssuedToken {
  dsn: string;
  role: string;
  expiresAt: string;
}

export function ShellTokenPanel({ projectId }: { projectId: string }) {
  const [token, setToken] = useState<IssuedToken | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function issue() {
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/db/shell-token`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      const data = (await res.json()) as IssuedToken;
      setToken(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token.dsn);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — user can select manually
    }
  }

  if (!token) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={issue}
          disabled={pending}
          className="self-start rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'issuing…' : 'issue a connection string'}
        </button>
        {error ? (
          <p className="rounded-md bg-red-400/10 px-3 py-2 font-mono text-xs text-red-400">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--color-primary)]/30 bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
          role: <code>{token.role}</code> · expires{' '}
          {new Date(token.expiresAt).toISOString().slice(11, 19)} UTC
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {copied ? 'copied!' : 'copy'}
          </button>
          <button
            type="button"
            onClick={issue}
            disabled={pending}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            {pending ? 'rotating…' : 'rotate'}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto rounded-md bg-[var(--color-bg)] p-3 font-mono text-[11px]">
        <code>{token.dsn}</code>
      </pre>
      <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
        save this somewhere safe — closing this page won&apos;t bring it back. it expires
        on its own; nothing to revoke.
      </p>
    </div>
  );
}
