'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface RoleMap {
  id: string;
  displayName: string;
  orgId: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  projectId: string;
  items: RoleMap[];
}

export function RoleMapsPanel({ projectId, items }: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [orgId, setOrgId] = useState('');
  const [role, setRole] = useState('member');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/scim/role-maps`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          orgId: orgId.trim(),
          role,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      setDisplayName('');
      setOrgId('');
      setRole('member');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setPending(false);
    }
  }

  async function remove(mapId: string): Promise<void> {
    setErr(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/scim/role-maps/${mapId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed');
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <div>
        <h3 className="font-mono text-sm text-[var(--color-text)]">SCIM group → team map</h3>
        <p className="mt-1 max-w-xl font-mono text-[11px] text-[var(--color-text-muted)]">
          When IT pushes a SCIM group (e.g. &quot;Engineering&quot;), put those people into a Briven
          Auth org. Use the org id from your organizations list (starts with something like{' '}
          <code className="text-[var(--color-text)]">org_</code>).
        </p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={(e) => void save(e)}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
            <span>SCIM group name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              placeholder="Engineering"
              className="rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
            <span>Briven org id</span>
            <input
              type="text"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              required
              placeholder="org_…"
              className="rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
            <span>role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'saving…' : 'save map'}
        </button>
      </form>

      {err ? <p className="font-mono text-xs text-[var(--color-error)]">{err}</p> : null}

      {items.length === 0 ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">no group maps yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full min-w-max font-mono text-xs">
            <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-normal">group name</th>
                <th className="px-3 py-2 font-normal">org id</th>
                <th className="px-3 py-2 font-normal">role</th>
                <th className="px-3 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="border-t border-[var(--color-border-subtle)]">
                  <td className="px-3 py-2 text-[var(--color-text)]">{m.displayName}</td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    <code className="text-[10px]">{m.orgId}</code>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">{m.role}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void remove(m.id)}
                      className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
