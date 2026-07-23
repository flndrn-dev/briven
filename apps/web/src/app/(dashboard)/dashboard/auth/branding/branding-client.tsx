'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

interface BrandingState {
  logoUrl: string;
  primaryColor: string;
  senderName: string;
}

const DEFAULT: BrandingState = {
  logoUrl: '',
  primaryColor: '#FFFD74',
  senderName: 'Briven Auth',
};

/**
 * briven-engine branding form — save via dashboard auth-core proxy.
 * Optional lockProjectId when opened from a project tab.
 */
export function AuthBrandingClient({
  projects,
  lockProjectId,
  engineMode = true,
}: {
  projects: AuthV2ProjectRow[];
  lockProjectId?: string;
  /** Prefer briven-engine paths (default true). */
  engineMode?: boolean;
}) {
  const enabled = projects.filter((p) => p.authEnabled !== false);
  const list = enabled.length ? enabled : projects;
  const [projectId, setProjectId] = useState(
    lockProjectId ?? list[0]?.id ?? '',
  );
  const [form, setForm] = useState<BrandingState>(DEFAULT);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);

  const load = useCallback(
    async (id: string) => {
      if (!id) return;
      setErr(null);
      const url = engineMode
        ? `/api/dashboard/auth-core/projects/${encodeURIComponent(id)}/config`
        : `/api/v1/projects/${id}/auth/config`;
      const res = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (res.status === 401) {
        setErr('sign in to briven.tech to manage branding');
        return;
      }
      if (!res.ok) {
        setErr(`load failed (${res.status})`);
        return;
      }
      const body = (await res.json()) as {
        branding?: {
          logoUrl?: string | null;
          primaryColor?: string;
          senderName?: string;
        };
        config?: {
          branding?: {
            logoUrl?: string | null;
            primaryColor?: string;
            senderName?: string;
          };
        };
      };
      const b = body.branding ?? body.config?.branding;
      if (b) {
        setForm({
          logoUrl: b.logoUrl ?? '',
          primaryColor: b.primaryColor ?? DEFAULT.primaryColor,
          senderName: b.senderName ?? DEFAULT.senderName,
        });
      } else {
        setForm(DEFAULT);
      }
    },
    [engineMode],
  );

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  async function save(): Promise<void> {
    if (!projectId) return;
    setPending(true);
    setErr(null);
    setProof(null);
    try {
      const payload = {
        logoUrl: form.logoUrl.trim() || null,
        primaryColor: form.primaryColor.trim() || DEFAULT.primaryColor,
        senderName: form.senderName.trim() || DEFAULT.senderName,
      };
      if (!/^#[0-9A-Fa-f]{6}$/.test(payload.primaryColor)) {
        throw new Error('primary color must be a 6-digit hex like #FFFD74');
      }
      if (
        payload.logoUrl &&
        !payload.logoUrl.startsWith('https://') &&
        !payload.logoUrl.startsWith('http://localhost')
      ) {
        throw new Error('logo URL must start with https://');
      }

      const url = engineMode
        ? `/api/dashboard/auth-core/projects/${encodeURIComponent(projectId)}/branding`
        : `/api/v1/projects/${projectId}/auth/config`;
      const res = await fetch(url, {
        method: engineMode ? 'PUT' : 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          engineMode ? payload : { branding: payload },
        ),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        branding?: BrandingState;
      };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);
      setProof(
        `saved · from “${payload.senderName}” · color ${payload.primaryColor}`,
      );
      await load(projectId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setPending(false);
    }
  }

  if (list.length === 0) {
    return (
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        create a project and enable Auth first.
      </p>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-5">
      {!lockProjectId ? (
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">project</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          >
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {/* Live preview */}
      <div
        className="rounded-md border p-4"
        style={{
          borderColor: 'var(--color-border-subtle)',
          background: '#141414',
        }}
      >
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
          email preview
        </p>
        {form.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={form.logoUrl}
            alt=""
            className="mt-3 max-h-12 max-w-[120px] object-contain"
          />
        ) : null}
        <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-[#888]">
          {form.senderName || 'Briven Auth'}
        </p>
        <div
          className="mt-2 h-[3px] w-12 rounded-sm"
          style={{ background: form.primaryColor || '#FFFD74' }}
        />
        <p className="mt-4 font-mono text-sm text-[#f2f2f2]">
          Your sign-in code: 123456
          <br />
          This code expires in 10 minutes.
        </p>
      </div>

      <label className="flex flex-col gap-1 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">logo URL (https)</span>
        <input
          value={form.logoUrl}
          onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
          placeholder="https://…"
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        />
      </label>

      <label className="flex flex-col gap-1 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">
          primary color (#hex)
        </span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={
              /^#[0-9A-Fa-f]{6}$/.test(form.primaryColor)
                ? form.primaryColor
                : '#FFFD74'
            }
            onChange={(e) =>
              setForm((f) => ({ ...f, primaryColor: e.target.value }))
            }
            className="h-9 w-12 cursor-pointer rounded border bg-transparent"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
          <input
            value={form.primaryColor}
            onChange={(e) =>
              setForm((f) => ({ ...f, primaryColor: e.target.value }))
            }
            className="flex-1 rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
        </div>
      </label>

      <label className="flex flex-col gap-1 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">email from name</span>
        <input
          value={form.senderName}
          onChange={(e) =>
            setForm((f) => ({ ...f, senderName: e.target.value }))
          }
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        />
        <span className="text-[10px] text-[var(--color-text-muted)]">
          Shows in the email header and subject (e.g. “Your Konnos sign-in”).
        </span>
      </label>

      <button
        type="button"
        disabled={pending}
        onClick={() => void save()}
        className="self-start rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
        style={{ background: '#FFFD74' }}
      >
        {pending ? 'saving…' : 'save branding'}
      </button>

      {proof ? (
        <p
          className="font-mono text-xs"
          style={{ color: 'var(--auth-accent, #FFFD74)' }}
        >
          {proof}
        </p>
      ) : null}
      {err ? (
        <p className="font-mono text-xs text-red-400">{err}</p>
      ) : null}
    </div>
  );
}
