'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

interface RedactedUser {
  id: string;
  emailDomainHint?: string;
  lastSeenAt?: string | null;
}

export function AuthSessionsClient({ projects }: { projects: AuthV2ProjectRow[] }) {
  const enabled = projects.filter((p) => p.authEnabled);
  const [projectId, setProjectId] = useState(enabled[0]?.id ?? '');
  const [items, setItems] = useState<RedactedUser[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setErr(null);
    const res = await fetch(`/api/v1/projects/${id}/auth/users?limit=50`, {
      credentials: 'include',
    });
    if (!res.ok) {
      setErr(`load failed (${res.status})`);
      return;
    }
    const body = (await res.json()) as { items?: RedactedUser[] };
    setItems(body.items ?? []);
  }, []);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  if (enabled.length === 0) {
    return (
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        enable Auth on a project first.
      </p>
    );
  }

  const withSession = items.filter((u) => u.lastSeenAt);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
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

      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        {withSession.length} user{withSession.length === 1 ? '' : 's'} with a recorded last sign-in
        {' · '}
        <Link href="/dashboard/auth/users" className="underline" style={{ color: 'var(--auth-accent)' }}>
          open users
        </Link>
      </p>

      <ul className="flex flex-col gap-2">
        {withSession.map((row) => (
          <li
            key={row.id}
            className="rounded-md border px-3 py-2 font-mono text-xs"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          >
            @{row.emailDomainHint ?? '?'} · last {row.lastSeenAt}
            <span className="mt-0.5 block text-[10px] text-[var(--color-text-muted)]">{row.id}</span>
          </li>
        ))}
      </ul>
      {err ? <p className="font-mono text-xs text-[var(--color-error)]">{err}</p> : null}
    </div>
  );
}
