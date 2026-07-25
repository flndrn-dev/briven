'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { AuthUserDetail } from '../../../lib/auth-api';

function shortTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusLabel(status?: string): string {
  if (status === 'held') return 'on hold';
  if (status === 'archived') return 'archived';
  return 'active';
}

export function UserManageClient({
  projectId,
  initialUser,
}: {
  projectId: string;
  initialUser: AuthUserDetail;
}) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const base = `/api/dashboard/auth-core/users/${encodeURIComponent(user.id)}`;

  async function refresh(): Promise<void> {
    const res = await fetch(
      `${base}?projectId=${encodeURIComponent(projectId)}`,
      { credentials: 'include' },
    );
    if (!res.ok) return;
    const body = (await res.json()) as { user?: AuthUserDetail };
    if (body.user) setUser(body.user);
  }

  async function post(
    path: string,
    body: Record<string, unknown>,
    actionKey: string,
  ): Promise<boolean> {
    setBusy(actionKey);
    setErr(null);
    setNote(null);
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, projectId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
        ok?: boolean;
      };
      if (!res.ok) {
        throw new Error(data.message ?? data.code ?? `failed (${res.status})`);
      }
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'action failed');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function hold(): Promise<void> {
    if (!(await post('/hold', { reason: reason || undefined }, 'hold'))) return;
    setNote('account put on hold — they cannot sign in');
    setReason('');
    await refresh();
    router.refresh();
  }

  async function unhold(): Promise<void> {
    if (!(await post('/unhold', {}, 'unhold'))) return;
    setNote('hold lifted — they can sign in again');
    await refresh();
    router.refresh();
  }

  async function archive(): Promise<void> {
    if (!(await post('/archive', { reason: reason || undefined }, 'archive')))
      return;
    setNote('account archived — data kept, login blocked, sessions cleared');
    setReason('');
    await refresh();
    router.refresh();
  }

  async function unarchive(): Promise<void> {
    if (!(await post('/unarchive', {}, 'unarchive'))) return;
    setNote('account restored from archive');
    await refresh();
    router.refresh();
  }

  async function revokeAll(): Promise<void> {
    if (!(await post('/sessions/revoke-all', {}, 'revoke-all'))) return;
    setNote('all live sessions revoked');
    await refresh();
  }

  async function revokeOne(handle: string): Promise<void> {
    if (
      !(await post(
        `/sessions/${encodeURIComponent(handle)}/revoke`,
        {},
        `revoke:${handle}`,
      ))
    )
      return;
    setNote('session revoked');
    await refresh();
  }

  async function hardDelete(): Promise<void> {
    if (deleteConfirm !== 'delete') {
      setErr('type delete in the box to confirm permanent removal');
      return;
    }
    const ok = await post(
      '/delete',
      { confirm: 'delete' },
      'delete',
    );
    if (!ok) return;
    setNote('user permanently deleted');
    router.push(`/dashboard/auth/${encodeURIComponent(projectId)}/users`);
    router.refresh();
  }

  const email = user.emails?.[0] ?? user.phoneNumbers?.[0] ?? 'user';
  const status = user.status ?? 'active';

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href={`/dashboard/auth/${encodeURIComponent(projectId)}/users`}
          className="font-mono text-xs text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)]"
        >
          ← users
        </Link>
        <h2 className="mt-2 font-mono text-lg tracking-tight text-[var(--color-text)]">
          {email}
        </h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          {user.id}
          {' · '}
          <span
            style={
              status === 'held'
                ? { color: 'var(--auth-accent, #FFFD74)' }
                : undefined
            }
          >
            {statusLabel(status)}
          </span>
          {user.timeJoined
            ? ` · joined ${new Date(user.timeJoined).toLocaleString()}`
            : null}
        </p>
      </div>

      {/* Access summary */}
      <section className="rounded-md border border-[var(--color-border-subtle)] p-4">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
          access
        </h3>
        <dl className="mt-3 grid gap-2 font-mono text-xs text-[var(--color-text)]">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-muted)]">email verified</dt>
            <dd>{user.emailVerified ? 'yes' : 'no'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-muted)]">roles</dt>
            <dd>
              {user.roles && user.roles.length > 0
                ? user.roles.join(', ')
                : 'none'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-muted)]">passkeys</dt>
            <dd>{user.passkeyCount ?? 0}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-muted)]">TOTP devices</dt>
            <dd>{user.totpCount ?? 0}</dd>
          </div>
          {user.heldReason ? (
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-text-muted)]">hold reason</dt>
              <dd>{user.heldReason}</dd>
            </div>
          ) : null}
          {user.archivedReason ? (
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-text-muted)]">archive reason</dt>
              <dd>{user.archivedReason}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* Linked logins */}
      <section className="rounded-md border border-[var(--color-border-subtle)] p-4">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
          linked logins
        </h3>
        {!user.linkedLogins || user.linkedLogins.length === 0 ? (
          <p className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
            no social / third-party logins linked
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5 font-mono text-xs">
            {user.linkedLogins.map((l) => (
              <li
                key={l.id}
                className="rounded border border-[var(--color-border-subtle)] px-2 py-1.5"
              >
                <span className="text-[var(--color-text)]">{l.provider}</span>
                <span className="mt-0.5 block text-[10px] text-[var(--color-text-muted)]">
                  …{l.providerUserId.slice(-8)} · {shortTime(l.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sessions */}
      <section className="rounded-md border border-[var(--color-border-subtle)] p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
            live sessions
          </h3>
          <button
            type="button"
            disabled={busy === 'revoke-all' || !(user.sessions?.length)}
            onClick={() => void revokeAll()}
            className="font-mono text-[10px] text-[var(--color-text-muted)] underline disabled:no-underline disabled:opacity-40"
          >
            {busy === 'revoke-all' ? '…' : 'revoke all'}
          </button>
        </div>
        {!user.sessions || user.sessions.length === 0 ? (
          <p className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
            no live sessions
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5 font-mono text-xs">
            {user.sessions.map((s) => (
              <li
                key={s.handle}
                className="flex items-center justify-between gap-2 rounded border border-[var(--color-border-subtle)] px-2 py-1.5"
              >
                <span>
                  <span className="text-[var(--color-text)]">
                    {s.handle.slice(0, 12)}…
                  </span>
                  <span className="mt-0.5 block text-[10px] text-[var(--color-text-muted)]">
                    since {shortTime(s.createdAt)} · expires{' '}
                    {shortTime(s.expiresAt)}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy === `revoke:${s.handle}`}
                  onClick={() => void revokeOne(s.handle)}
                  className="font-mono text-[10px] text-[var(--color-text-muted)] underline disabled:opacity-40"
                >
                  {busy === `revoke:${s.handle}` ? '…' : 'revoke'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Moderation actions */}
      <section className="rounded-md border border-[var(--color-border-subtle)] p-4">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
          manage account
        </h3>
        <label className="mt-3 flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">
            reason (optional — for hold / archive)
          </span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. payment issue, abuse report"
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2"
            style={{ borderColor: 'var(--auth-accent-border, #333)' }}
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          {status === 'held' ? (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void unhold()}
              className="rounded-md px-3 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
              style={{ background: 'var(--auth-accent, #FFFD74)' }}
            >
              {busy === 'unhold' ? '…' : 'lift hold'}
            </button>
          ) : status !== 'archived' ? (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void hold()}
              className="rounded-md border px-3 py-2 font-mono text-xs text-[var(--color-text)] disabled:opacity-50"
              style={{ borderColor: 'var(--auth-accent, #FFFD74)' }}
            >
              {busy === 'hold' ? '…' : 'put on hold'}
            </button>
          ) : null}

          {status === 'archived' ? (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void unarchive()}
              className="rounded-md border px-3 py-2 font-mono text-xs text-[var(--color-text)] disabled:opacity-50"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {busy === 'unarchive' ? '…' : 'restore from archive'}
            </button>
          ) : (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void archive()}
              className="rounded-md border px-3 py-2 font-mono text-xs text-[var(--color-text-muted)] disabled:opacity-50"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {busy === 'archive' ? '…' : 'archive'}
            </button>
          )}
        </div>
        <p className="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
          <strong className="text-[var(--color-text)]">hold</strong> blocks
          sign-in and sessions; data stays. You can lift it later.{' '}
          <strong className="text-[var(--color-text)]">archive</strong> also
          kicks all sessions and hides the account until restore.
        </p>
      </section>

      {/* Hard delete */}
      <section className="rounded-md border border-red-900/50 p-4">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-red-400/80">
          delete forever
        </h3>
        <p className="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
          permanently removes this user and their credentials. their email can
          sign up again as a new account. this cannot be undone.
        </p>
        <label className="mt-3 flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">
            type <code className="text-red-400">delete</code> to confirm
          </span>
          <input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            className="rounded-md border border-red-900/40 bg-[var(--color-surface)] px-3 py-2"
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          disabled={!!busy || deleteConfirm !== 'delete'}
          onClick={() => void hardDelete()}
          className="mt-3 rounded-md bg-red-600/90 px-3 py-2 font-mono text-xs font-medium text-white disabled:opacity-40"
        >
          {busy === 'delete' ? '…' : 'delete forever'}
        </button>
      </section>

      {note ? (
        <p
          className="font-mono text-xs"
          style={{ color: 'var(--auth-accent, #FFFD74)' }}
        >
          {note}
        </p>
      ) : null}
      {err ? (
        <p className="font-mono text-xs text-red-400">{err}</p>
      ) : null}
    </div>
  );
}
