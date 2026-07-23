'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/**
 * Create a role from the yellow Auth security tab.
 * Calls /api/v1/auth-core/roles (proxied to the API with your cookie).
 */
export function AuthRolesForm() {
  const router = useRouter();
  const [role, setRole] = useState('');
  const [permissions, setPermissions] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const name = role.trim();
    if (!name) return;
    setPending(true);
    setErr(null);
    setOkMsg(null);
    try {
      const perms = permissions
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const res = await fetch('/api/v1/auth-core/roles', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: name, permissions: perms }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        code?: string;
      };
      if (!res.ok || body.ok === false) {
        throw new Error(
          body.message ?? body.code ?? `could not create role (${res.status})`,
        );
      }
      setRole('');
      setPermissions('');
      setOkMsg(body.message === 'updated' ? 'role updated' : 'role created');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
            role name
          </span>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="admin"
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[color-mix(in_srgb,#FFFD74_50%,var(--color-border))]"
            disabled={pending}
          />
        </label>
        <label className="flex flex-[2] flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
            permissions (comma-separated)
          </span>
          <input
            value={permissions}
            onChange={(e) => setPermissions(e.target.value)}
            placeholder="read, write, *"
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[color-mix(in_srgb,#FFFD74_50%,var(--color-border))]"
            disabled={pending}
          />
        </label>
        <button
          type="submit"
          disabled={pending || !role.trim()}
          className="rounded-md px-4 py-2 font-mono text-xs font-medium disabled:opacity-50"
          style={{ background: '#FFFD74', color: '#111' }}
        >
          {pending ? 'saving…' : 'save role'}
        </button>
      </div>
      {err ? (
        <p className="font-mono text-xs text-red-400">{err}</p>
      ) : null}
      {okMsg ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">{okMsg}</p>
      ) : null}
    </form>
  );
}
