'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

interface RedactedUser {
  id: string;
  emailDomainHint?: string;
  lastSeenAt?: string | null;
  nameInitial?: string | null;
}

interface DeviceRow {
  id: string;
  hint: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionRow {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  hint: string;
}

function shortTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Pick a user, see known devices + live sessions.
 * Full manage (unlink accounts) lives under users.
 */
export function AuthSessionsClient({ projects }: { projects: AuthV2ProjectRow[] }) {
  const enabled = projects.filter((p) => p.authEnabled);
  const [projectId, setProjectId] = useState(enabled[0]?.id ?? '');
  const [users, setUsers] = useState<RedactedUser[]>([]);
  const [userId, setUserId] = useState('');
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const loadUsers = useCallback(async (id: string) => {
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
    const list = body.items ?? [];
    setUsers(list);
    setUserId((prev) => (prev && list.some((u) => u.id === prev) ? prev : (list[0]?.id ?? '')));
  }, []);

  const loadDetail = useCallback(async (pid: string, uid: string) => {
    if (!pid || !uid) {
      setDevices([]);
      setSessions([]);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // Devices stay on project-local table; sessions prefer briven-engine be_sessions.
      const [dRes, engineSess, legacySess] = await Promise.all([
        fetch(`/api/v1/projects/${pid}/auth/users/${uid}/devices`, { credentials: 'include' }),
        fetch(
          `/api/v1/auth-core/session/list?userId=${encodeURIComponent(uid)}&projectId=${encodeURIComponent(pid)}`,
          { credentials: 'include' },
        ),
        fetch(`/api/v1/projects/${pid}/auth/users/${uid}/sessions`, { credentials: 'include' }),
      ]);
      if (dRes.ok) {
        const b = (await dRes.json()) as { items?: DeviceRow[] };
        setDevices(b.items ?? []);
      } else setDevices([]);
      if (engineSess.ok) {
        const b = (await engineSess.json()) as { handles?: string[] };
        const handles = b.handles ?? [];
        setSessions(
          handles.map((h) => ({
            id: h,
            createdAt: '',
            expiresAt: null,
            hint: 'briven-engine session',
          })),
        );
      } else if (legacySess.ok) {
        const b = (await legacySess.json()) as { items?: SessionRow[] };
        setSessions(b.items ?? []);
      } else setSessions([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (projectId) void loadUsers(projectId);
  }, [projectId, loadUsers]);

  useEffect(() => {
    if (projectId && userId) void loadDetail(projectId, userId);
  }, [projectId, userId, loadDetail]);

  async function revokeSession(sessionId: string): Promise<void> {
    if (!projectId || !userId) return;
    setNote(null);
    setErr(null);
    // Prefer engine revoke (be_sessions handle); fall back to legacy project sessions.
    let res = await fetch(`/api/v1/auth-core/session/revoke`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionHandle: sessionId, projectId }),
    });
    if (!res.ok) {
      res = await fetch(
        `/api/v1/projects/${projectId}/auth/users/${userId}/sessions/${sessionId}/revoke`,
        { method: 'POST', credentials: 'include' },
      );
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setErr(body.message ?? `revoke failed (${res.status})`);
      return;
    }
    setNote('session revoked');
    await loadDetail(projectId, userId);
  }

  if (enabled.length === 0) {
    return (
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        enable Auth on a project first.
      </p>
    );
  }

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

      {users.length === 0 ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          no users yet — when someone signs in, devices appear here.
        </p>
      ) : (
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">user</span>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nameInitial ? `${u.nameInitial} · ` : ''}@{u.emailDomainHint ?? '?'} ·{' '}
                {u.id.slice(0, 10)}…
              </option>
            ))}
          </select>
        </label>
      )}

      {busy ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">loading…</p>
      ) : userId ? (
        <>
          <section className="flex flex-col gap-2">
            <h3 className="font-mono text-xs uppercase tracking-widest text-[var(--color-text-muted)]">
              known devices ({devices.length})
            </h3>
            <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
              first time a browser signs in, we remember a fingerprint and email the
              user. no raw IP stored.
            </p>
            {devices.length === 0 ? (
              <p className="font-mono text-xs text-[var(--color-text-muted)]">none yet</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {devices.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-md border px-3 py-2 font-mono text-xs"
                    style={{ borderColor: 'var(--auth-accent-border)' }}
                  >
                    <span className="text-[var(--color-text)]">{d.hint}</span>
                    <span className="mt-0.5 block text-[10px] text-[var(--color-text-muted)]">
                      first {shortTime(d.createdAt)} · last {shortTime(d.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-mono text-xs uppercase tracking-widest text-[var(--color-text-muted)]">
              live sessions ({sessions.length})
            </h3>
            {sessions.length === 0 ? (
              <p className="font-mono text-xs text-[var(--color-text-muted)]">none live</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {sessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 font-mono text-xs"
                    style={{ borderColor: 'var(--auth-accent-border)' }}
                  >
                    <span>
                      <span className="text-[var(--color-text)]">{s.hint || 'session'}</span>
                      <span className="mt-0.5 block text-[10px] text-[var(--color-text-muted)]">
                        since {shortTime(s.createdAt)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void revokeSession(s.id)}
                      className="text-[10px] underline text-[var(--color-text-muted)]"
                    >
                      revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
            linked Google/GitHub accounts:{' '}
            <Link
              href="/dashboard/auth/users"
              className="underline"
              style={{ color: 'var(--auth-accent)' }}
            >
              open users → details
            </Link>
          </p>
        </>
      ) : null}

      {note ? (
        <p className="font-mono text-xs" style={{ color: 'var(--auth-accent)' }}>
          {note}
        </p>
      ) : null}
      {err ? <p className="font-mono text-xs text-[var(--color-error)]">{err}</p> : null}
    </div>
  );
}
