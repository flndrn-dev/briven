'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { AuthV2ProjectRow, AuthV2ProviderFlags } from '../lib/auth-v2-types';

const LABELS: { key: keyof AuthV2ProviderFlags; label: string; help: string }[] = [
  {
    key: 'emailPassword',
    label: 'email + password',
    help: 'classic password login',
  },
  {
    key: 'magicLink',
    label: 'magic link',
    help: 'one-click link in email — opens on your project URL',
  },
  {
    key: 'emailOtp',
    label: 'email code (OTP)',
    help: '6-digit code in email',
  },
  {
    key: 'passkey',
    label: 'passkey',
    help: 'Face ID / Touch ID / security key',
  },
];

export function AuthProvidersClient({ projects }: { projects: AuthV2ProjectRow[] }) {
  const router = useRouter();
  const search = useSearchParams();
  const fromQuery = search.get('project') ?? '';
  const enabledProjects = projects.filter((p) => p.authEnabled);

  const [projectId, setProjectId] = useState(
    fromQuery && enabledProjects.some((p) => p.id === fromQuery)
      ? fromQuery
      : (enabledProjects[0]?.id ?? ''),
  );
  const [flags, setFlags] = useState<AuthV2ProviderFlags>({
    emailPassword: true,
    magicLink: true,
    emailOtp: true,
    passkey: true,
  });
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setErr(null);
    setProof(null);
    const res = await fetch(`/api/v1/auth-v2/projects/${id}/snapshot`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setErr(body.message ?? `could not load (${res.status})`);
      return;
    }
    const body = (await res.json()) as {
      enabled: boolean;
      providers: AuthV2ProviderFlags | null;
    };
    if (body.providers) setFlags(body.providers);
  }, []);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  async function save(): Promise<void> {
    if (!projectId) return;
    setPending(true);
    setErr(null);
    setProof(null);
    try {
      const res = await fetch(`/api/v1/auth-v2/projects/${projectId}/providers`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(flags),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        proof?: AuthV2ProviderFlags;
        providers?: AuthV2ProviderFlags;
        savedAt?: string;
      };
      if (!res.ok) {
        throw new Error(body.message ?? `http ${res.status}`);
      }
      const live = body.proof ?? body.providers;
      if (live) setFlags(live);
      setProof(
        `saved ${body.savedAt ?? 'ok'} — live proof: magic ${live?.magicLink ? 'ON' : 'OFF'}, otp ${live?.emailOtp ? 'ON' : 'OFF'}, passkey ${live?.passkey ? 'ON' : 'OFF'}, password ${live?.emailPassword ? 'ON' : 'OFF'}`,
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setPending(false);
    }
  }

  if (enabledProjects.length === 0) {
    return (
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        no project has Auth enabled yet — open{' '}
        <a href="/dashboard/auth/projects" className="underline" style={{ color: 'var(--auth-accent)' }}>
          projects
        </a>{' '}
        and enable Auth first.
      </p>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <label className="flex flex-col gap-1 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">project</span>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        >
          {enabledProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.slug})
            </option>
          ))}
        </select>
      </label>

      <ul className="flex flex-col gap-3">
        {LABELS.map((row) => (
          <li
            key={row.key}
            className="flex items-start justify-between gap-4 rounded-md border p-3"
            style={{
              borderColor: 'var(--auth-accent-border)',
              background: 'var(--color-surface-raised)',
            }}
          >
            <div>
              <p className="font-mono text-sm text-[var(--color-text)]">{row.label}</p>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                {row.help}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={flags[row.key]}
              onClick={() => setFlags((f) => ({ ...f, [row.key]: !f[row.key] }))}
              className="relative h-6 w-11 shrink-0 rounded-full transition"
              style={{
                background: flags[row.key] ? '#e6b800' : 'var(--color-border)',
              }}
            >
              <span
                className="absolute top-0.5 size-5 rounded-full bg-white transition"
                style={{ left: flags[row.key] ? '1.35rem' : '0.15rem' }}
              />
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={pending}
        onClick={() => void save()}
        className="self-start rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
        style={{ background: '#e6b800' }}
      >
        {pending ? 'saving…' : 'save methods (with live proof)'}
      </button>

      {proof ? (
        <p className="font-mono text-xs" style={{ color: 'var(--auth-accent)' }}>
          {proof}
        </p>
      ) : null}
      {err ? <p className="font-mono text-xs text-[var(--color-error)]">{err}</p> : null}
    </div>
  );
}
