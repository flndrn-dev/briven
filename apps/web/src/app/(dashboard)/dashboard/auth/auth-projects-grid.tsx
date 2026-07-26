'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { AuthV2ProjectRow } from './lib/auth-v2-types';

/**
 * Auth home — same card-grid language as Projects.
 * Click a card → that project's Auth (users, sessions, keys, …).
 */
export function AuthProjectsGrid({
  projects,
}: {
  projects: AuthV2ProjectRow[];
}) {
  const [rows, setRows] = useState(projects);
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = !needle
      ? rows
      : rows.filter(
          (p) =>
            p.name.toLowerCase().includes(needle) ||
            p.slug.toLowerCase().includes(needle) ||
            p.id.toLowerCase().includes(needle),
        );
    // A → Z by display name (case-insensitive)
    return [...list].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
  }, [rows, q]);

  async function enable(projectId: string): Promise<void> {
    setBusyId(projectId);
    setErr(null);
    try {
      const res = await fetch(
        `/api/v1/auth-core/projects/${encodeURIComponent(projectId)}/enable`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === projectId
            ? {
                ...r,
                authEnabled: true,
                providers: {
                  emailPassword: true,
                  magicLink: true,
                  emailOtp: true,
                  passkey: true,
                },
                error: false,
              }
            : r,
        ),
      );
      // Full navigation so server workspace re-reads be_tenants (no stale RSC cache).
      window.location.assign(`/dashboard/auth/${projectId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'enable failed');
      setBusyId(null);
    }
  }

  async function disable(projectId: string, projectName: string): Promise<void> {
    const ok = window.confirm(
      `Turn Auth off for “${projectName}”?\n\n` +
        `Apps using Briven Auth for this project will stop signing people in.\n` +
        `Your users and settings are kept — you can enable Auth again anytime.`,
    );
    if (!ok) return;
    setBusyId(projectId);
    setErr(null);
    try {
      const res = await fetch(
        `/api/v1/auth-core/projects/${encodeURIComponent(projectId)}/disable`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === projectId
            ? {
                ...r,
                authEnabled: false,
                tenantId: null,
                providers: null,
                error: false,
              }
            : r,
        ),
      );
      // Stay on Auth home so the card shows off + enable again.
      window.location.assign('/dashboard/auth');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'disable failed');
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--color-border)] p-8">
        <p className="font-mono text-sm text-[var(--color-text)]">
          no projects yet
        </p>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          create a project first, then turn Auth on for it here.
        </p>
        <Link
          href="/dashboard/projects/new"
          className="mt-4 inline-block rounded-md px-3 py-1.5 font-mono text-xs font-medium text-black"
          style={{ background: 'var(--auth-accent, #FFFD74)' }}
        >
          + new project
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {err ? (
        <p className="font-mono text-xs text-red-400">{err}</p>
      ) : null}

      {rows.length > 5 ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter by name / slug / id"
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[var(--auth-accent,#FFFD74)]"
          />
          {q ? (
            <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              {filtered.length} of {rows.length}
            </span>
          ) : null}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center font-mono text-xs text-[var(--color-text-muted)]">
          no projects match that filter.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => (
            <li
              key={p.id}
              className="group relative flex flex-col rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] transition hover:border-[var(--color-border)]"
            >
              {p.authEnabled ? (
                <div className="flex flex-1 flex-col gap-1.5 p-4">
                  <Link
                    href={`/dashboard/auth/${p.id}`}
                    className="flex flex-1 flex-col gap-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-mono text-sm text-[var(--color-text)]">
                        {p.name}
                      </p>
                      <AuthBadge on />
                    </div>
                    <p className="font-mono text-xs text-[var(--color-text-subtle)]">
                      {p.slug}
                      {p.tenantId ? (
                        <span className="text-[var(--color-text-muted)]">
                          {' · '}
                          {p.tenantId}
                        </span>
                      ) : null}
                    </p>
                    <span
                      className="pt-2 font-mono text-xs"
                      style={{ color: 'var(--auth-accent, #FFFD74)' }}
                    >
                      open Auth →
                    </span>
                  </Link>
                  <div className="mt-2 flex items-center justify-end border-t border-[var(--color-border-subtle)] pt-2">
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void disable(p.id, p.name);
                      }}
                      className="rounded-md border border-[var(--color-border)] px-2.5 py-1 font-mono text-[10px] text-[var(--color-text-muted)] transition hover:border-red-500/40 hover:text-red-300 disabled:opacity-50"
                    >
                      {busyId === p.id ? 'disabling…' : 'disable Auth'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 flex-col gap-1.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-sm text-[var(--color-text)]">
                      {p.name}
                    </p>
                    <AuthBadge on={false} />
                  </div>
                  <p className="font-mono text-xs text-[var(--color-text-subtle)]">
                    {p.slug}
                  </p>
                  <div className="mt-auto pt-2">
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => void enable(p.id)}
                      className="rounded-md px-2.5 py-1 font-mono text-[10px] font-medium text-black disabled:opacity-50"
                      style={{ background: 'var(--auth-accent, #FFFD74)' }}
                    >
                      {busyId === p.id ? 'enabling…' : 'enable Auth'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AuthBadge({ on }: { on: boolean }) {
  if (on) {
    return (
      <span
        className="shrink-0 font-mono text-[10px] uppercase tracking-wider"
        style={{ color: 'var(--auth-accent, #FFFD74)' }}
      >
        on
      </span>
    );
  }
  return (
    <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
      off
    </span>
  );
}
