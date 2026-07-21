'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

export function AuthProjectsClient({ initial }: { initial: AuthV2ProjectRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function enable(projectId: string): Promise<void> {
    setBusyId(projectId);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/enable`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
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
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'enable failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {err ? (
        <p className="font-mono text-xs text-[var(--color-error)]">{err}</p>
      ) : null}

      {rows.length === 0 ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          no projects yet — create one under Projects first.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
              style={{
                borderColor: 'var(--auth-accent-border, var(--color-border))',
                background: 'var(--color-surface-raised)',
              }}
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-[var(--color-text)]">{p.name}</p>
                <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                  {p.slug} · <code>{p.id}</code>
                </p>
                <p className="mt-2 font-mono text-xs">
                  {p.error ? (
                    <span className="text-[var(--color-error)]">could not read auth status</span>
                  ) : p.authEnabled ? (
                    <span style={{ color: 'var(--auth-accent, #e6b800)' }}>
                      Auth ON
                      {p.providers
                        ? ` · pwd ${p.providers.emailPassword ? '✓' : '–'} · magic ${p.providers.magicLink ? '✓' : '–'} · otp ${p.providers.emailOtp ? '✓' : '–'} · passkey ${p.providers.passkey ? '✓' : '–'}`
                        : ''}
                    </span>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">Auth off</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {!p.authEnabled && !p.error ? (
                  <button
                    type="button"
                    disabled={busyId === p.id}
                    onClick={() => void enable(p.id)}
                    className="rounded-md px-3 py-1.5 font-mono text-xs font-medium text-black disabled:opacity-50"
                    style={{ background: '#e6b800' }}
                  >
                    {busyId === p.id ? 'enabling…' : 'enable Auth'}
                  </button>
                ) : null}
                {p.authEnabled ? (
                  <Link
                    href={`/dashboard/auth/providers?project=${encodeURIComponent(p.id)}`}
                    className="rounded-md border px-3 py-1.5 font-mono text-xs text-[var(--color-text)]"
                    style={{ borderColor: 'var(--auth-accent-border)' }}
                  >
                    configure →
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
