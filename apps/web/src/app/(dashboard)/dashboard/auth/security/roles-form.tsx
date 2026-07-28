'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/**
 * Create a role from the yellow Auth security tab.
 * Calls /api/v1/auth-core/roles (proxied to the API with your cookie).
 */
export function AuthRolesForm({ projectId }: { projectId?: string }) {
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
        body: JSON.stringify({
          role: name,
          permissions: perms,
          ...(projectId ? { projectId } : {}),
        }),
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

  const [userId, setUserId] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);

  async function assignOrUnassign(mode: 'assign' | 'unassign') {
    const name = role.trim();
    const uid = userId.trim();
    if (!name || !uid) {
      setErr('role name and user id required to assign/unassign');
      return;
    }
    setAssignBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/v1/auth-core/roles/${mode}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: name,
          userId: uid,
          ...(projectId ? { projectId } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        code?: string;
      };
      if (!res.ok || body.ok === false) {
        throw new Error(body.message ?? body.code ?? `${mode} failed (${res.status})`);
      }
      setOkMsg(body.message ?? mode);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : `${mode} failed`);
    } finally {
      setAssignBusy(false);
    }
  }

  async function deleteRole() {
    const name = role.trim();
    if (!name) return;
    setPending(true);
    setErr(null);
    setOkMsg(null);
    try {
      const res = await fetch('/api/v1/auth-core/roles', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: name,
          ...(projectId ? { projectId } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        code?: string;
      };
      if (!res.ok || body.ok === false) {
        throw new Error(body.message ?? body.code ?? `delete failed (${res.status})`);
      }
      setRole('');
      setOkMsg(body.message ?? 'deleted');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed');
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
        <button
          type="button"
          onClick={() => void deleteRole()}
          disabled={pending || !role.trim()}
          className="rounded-md border border-red-500/40 px-3 py-2 font-mono text-xs text-red-300 disabled:opacity-50"
        >
          delete role
        </button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
            user id (beu_…)
          </span>
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="beu_…"
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[color-mix(in_srgb,#FFFD74_50%,var(--color-border))]"
            disabled={assignBusy}
          />
        </label>
        <button
          type="button"
          onClick={() => void assignOrUnassign('assign')}
          disabled={assignBusy || !role.trim() || !userId.trim()}
          className="rounded-md px-3 py-2 font-mono text-xs disabled:opacity-50"
          style={{ background: '#FFFD74', color: '#111' }}
        >
          assign
        </button>
        <button
          type="button"
          onClick={() => void assignOrUnassign('unassign')}
          disabled={assignBusy || !role.trim() || !userId.trim()}
          className="rounded-md border border-[var(--color-border-subtle)] px-3 py-2 font-mono text-xs disabled:opacity-50"
        >
          unassign
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
