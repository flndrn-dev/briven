'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

interface RedactedUser {
  id: string;
  emailDomainHint?: string;
  nameInitial?: string | null;
  providerIds?: string[];
  lastSeenAt?: string | null;
  createdAt?: string;
}

interface DeviceRow {
  id: string;
  fingerprint: string;
  userAgent: string | null;
  hint: string;
  createdAt: string;
  updatedAt: string;
}

interface AccountRow {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: string | Date;
}

interface SessionRow {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  userAgent: string | null;
  hint: string;
}

function providerLabel(id: string): string {
  const known: Record<string, string> = {
    credential: 'email + password',
    google: 'Google',
    github: 'GitHub',
    discord: 'Discord',
    microsoft: 'Microsoft',
    apple: 'Apple',
    twitter: 'X / Twitter',
    konnos: 'Konnos',
    passkey: 'passkey',
  };
  return known[id] ?? id;
}

function shortTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AuthUsersClient({ projects }: { projects: AuthV2ProjectRow[] }) {
  const enabled = projects.filter((p) => p.authEnabled);
  const [projectId, setProjectId] = useState(enabled[0]?.id ?? '');
  const [items, setItems] = useState<RedactedUser[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
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
    const body = (await res.json()) as { users?: RedactedUser[]; items?: RedactedUser[] };
    setItems(body.users ?? body.items ?? []);
  }, []);

  const loadDetail = useCallback(async (pid: string, userId: string) => {
    setDetailBusy(true);
    setErr(null);
    setNote(null);
    try {
      const [devRes, accRes, sesRes] = await Promise.all([
        fetch(`/api/v1/projects/${pid}/auth/users/${userId}/devices`, {
          credentials: 'include',
        }),
        fetch(`/api/v1/projects/${pid}/auth/users/${userId}/accounts`, {
          credentials: 'include',
        }),
        fetch(`/api/v1/projects/${pid}/auth/users/${userId}/sessions`, {
          credentials: 'include',
        }),
      ]);

      if (devRes.ok) {
        const b = (await devRes.json()) as { items?: DeviceRow[] };
        setDevices(b.items ?? []);
      } else {
        setDevices([]);
      }

      if (accRes.ok) {
        const b = (await accRes.json()) as { accounts?: AccountRow[] };
        setAccounts(b.accounts ?? []);
      } else {
        setAccounts([]);
      }

      if (sesRes.ok) {
        const b = (await sesRes.json()) as { items?: SessionRow[] };
        setSessions(b.items ?? []);
      } else {
        setSessions([]);
      }

      if (!devRes.ok && !accRes.ok && !sesRes.ok) {
        setErr(`could not load user detail (${devRes.status})`);
      }
    } finally {
      setDetailBusy(false);
    }
  }, []);

  useEffect(() => {
    if (projectId) {
      setOpenId(null);
      setDevices([]);
      setAccounts([]);
      setSessions([]);
      void loadUsers(projectId);
    }
  }, [projectId, loadUsers]);

  async function toggleUser(userId: string): Promise<void> {
    if (openId === userId) {
      setOpenId(null);
      return;
    }
    setOpenId(userId);
    await loadDetail(projectId, userId);
  }

  async function unlinkAccount(userId: string, accountId: string): Promise<void> {
    if (!projectId) return;
    setActionBusy(`unlink:${accountId}`);
    setErr(null);
    setNote(null);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/auth/users/${userId}/accounts/${accountId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
      if (!res.ok) {
        throw new Error(body.message ?? body.code ?? `unlink failed (${res.status})`);
      }
      setNote('account unlinked');
      await loadDetail(projectId, userId);
      await loadUsers(projectId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unlink failed');
    } finally {
      setActionBusy(null);
    }
  }

  async function revokeSession(userId: string, sessionId: string): Promise<void> {
    if (!projectId) return;
    setActionBusy(`revoke:${sessionId}`);
    setErr(null);
    setNote(null);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/auth/users/${userId}/sessions/${sessionId}/revoke`,
        { method: 'POST', credentials: 'include' },
      );
      const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
      if (!res.ok) {
        throw new Error(body.message ?? body.code ?? `revoke failed (${res.status})`);
      }
      setNote('session revoked');
      await loadDetail(projectId, userId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'revoke failed');
    } finally {
      setActionBusy(null);
    }
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

      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        {items.length} user{items.length === 1 ? '' : 's'} (privacy-redacted) · click a row for
        devices + linked logins
      </p>

      <ul className="flex flex-col gap-2">
        {items.map((row) => {
          const open = openId === row.id;
          return (
            <li
              key={row.id}
              className="rounded-md border font-mono text-xs"
              style={{ borderColor: 'var(--auth-accent-border)' }}
            >
              <button
                type="button"
                onClick={() => void toggleUser(row.id)}
                className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--color-surface)]"
              >
                <span>
                  <span className="text-[var(--color-text)]">
                    {row.nameInitial ? `${row.nameInitial} · ` : ''}
                    {row.emailDomainHint ? `@${row.emailDomainHint}` : 'user'}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-[var(--color-text-muted)]">
                    {row.id}
                    {row.providerIds?.length ? ` · ${row.providerIds.join(', ')}` : ''}
                    {row.lastSeenAt ? ` · last ${shortTime(row.lastSeenAt)}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
                  {open ? 'hide ▲' : 'details ▼'}
                </span>
              </button>

              {open ? (
                <div
                  className="border-t px-3 py-3"
                  style={{ borderColor: 'var(--auth-accent-border)' }}
                >
                  {detailBusy ? (
                    <p className="text-[var(--color-text-muted)]">loading…</p>
                  ) : (
                    <div className="flex flex-col gap-5">
                      {/* Phase 8.3 — linked accounts */}
                      <section>
                        <h4 className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
                          linked logins (account linking)
                        </h4>
                        <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                          same email with Google + GitHub becomes one user automatically. you can
                          unlink a method if they still have another way in.
                        </p>
                        {accounts.length === 0 ? (
                          <p className="mt-2 text-[var(--color-text-muted)]">no accounts listed</p>
                        ) : (
                          <ul className="mt-2 flex flex-col gap-1.5">
                            {accounts.map((a) => (
                              <li
                                key={a.id}
                                className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
                                style={{ borderColor: 'var(--auth-accent-border)' }}
                              >
                                <span className="text-[var(--color-text)]">
                                  {providerLabel(a.providerId)}
                                  <span className="ml-2 text-[10px] text-[var(--color-text-muted)]">
                                    …{String(a.accountId).slice(-6)}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  disabled={actionBusy === `unlink:${a.id}` || accounts.length <= 1}
                                  title={
                                    accounts.length <= 1
                                      ? 'cannot remove the only sign-in method'
                                      : 'unlink this method'
                                  }
                                  onClick={() => void unlinkAccount(row.id, a.id)}
                                  className="rounded px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] underline disabled:no-underline disabled:opacity-40"
                                >
                                  {actionBusy === `unlink:${a.id}` ? '…' : 'unlink'}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>

                      {/* Phase 8.2 — devices */}
                      <section>
                        <h4 className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
                          known devices
                        </h4>
                        <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                          remembered after sign-in. a new device sends a security email to the
                          user.
                        </p>
                        {devices.length === 0 ? (
                          <p className="mt-2 text-[var(--color-text-muted)]">
                            no devices recorded yet
                          </p>
                        ) : (
                          <ul className="mt-2 flex flex-col gap-1.5">
                            {devices.map((d) => (
                              <li
                                key={d.id}
                                className="rounded border px-2 py-1.5"
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

                      {/* Sessions (bonus — already had API) */}
                      <section>
                        <h4 className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
                          live sessions
                        </h4>
                        {sessions.length === 0 ? (
                          <p className="mt-2 text-[var(--color-text-muted)]">no live sessions</p>
                        ) : (
                          <ul className="mt-2 flex flex-col gap-1.5">
                            {sessions.map((s) => (
                              <li
                                key={s.id}
                                className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
                                style={{ borderColor: 'var(--auth-accent-border)' }}
                              >
                                <span>
                                  <span className="text-[var(--color-text)]">
                                    {s.hint || 'session'}
                                  </span>
                                  <span className="mt-0.5 block text-[10px] text-[var(--color-text-muted)]">
                                    since {shortTime(s.createdAt)}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  disabled={actionBusy === `revoke:${s.id}`}
                                  onClick={() => void revokeSession(row.id, s.id)}
                                  className="rounded px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] underline disabled:opacity-40"
                                >
                                  {actionBusy === `revoke:${s.id}` ? '…' : 'revoke'}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    </div>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {note ? (
        <p className="font-mono text-xs" style={{ color: 'var(--auth-accent)' }}>
          {note}
        </p>
      ) : null}
      {err ? <p className="font-mono text-xs text-[var(--color-error)]">{err}</p> : null}
    </div>
  );
}
