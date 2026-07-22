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
  primaryColor: '#00e87a',
  senderName: 'Briven Auth',
};

export function AuthBrandingClient({ projects }: { projects: AuthV2ProjectRow[] }) {
  const enabled = projects.filter((p) => p.authEnabled);
  const [projectId, setProjectId] = useState(enabled[0]?.id ?? '');
  const [form, setForm] = useState<BrandingState>(DEFAULT);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setErr(null);
    const res = await fetch(`/api/v1/projects/${id}/auth/config`, { credentials: 'include' });
    if (!res.ok) {
      setErr(`load failed (${res.status})`);
      return;
    }
    const body = (await res.json()) as {
      config?: { branding?: { logoUrl?: string | null; primaryColor?: string; senderName?: string } };
      branding?: { logoUrl?: string | null; primaryColor?: string; senderName?: string };
    };
    const b = body.config?.branding ?? body.branding;
    if (b) {
      setForm({
        logoUrl: b.logoUrl ?? '',
        primaryColor: b.primaryColor ?? '#00e87a',
        senderName: b.senderName ?? 'Briven Auth',
      });
    }
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
      const res = await fetch(`/api/v1/projects/${projectId}/auth/config`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          branding: {
            logoUrl: form.logoUrl.trim() || null,
            primaryColor: form.primaryColor,
            senderName: form.senderName.trim() || 'Briven Auth',
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);
      setProof(`branding saved · color ${form.primaryColor} · from “${form.senderName}”`);
      await load(projectId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setPending(false);
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
    <div className="flex max-w-xl flex-col gap-4">
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

      <label className="flex flex-col gap-1 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">logo URL (https)</span>
        <input
          value={form.logoUrl}
          onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
          placeholder="https://…"
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        />
      </label>

      <label className="flex flex-col gap-1 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">primary color (#hex)</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={form.primaryColor}
            onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
            className="h-9 w-12 cursor-pointer rounded border bg-transparent"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
          <input
            value={form.primaryColor}
            onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
            className="flex-1 rounded-md border bg-[var(--color-surface)] px-3 py-2"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
        </div>
      </label>

      <label className="flex flex-col gap-1 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">email from name</span>
        <input
          value={form.senderName}
          onChange={(e) => setForm((f) => ({ ...f, senderName: e.target.value }))}
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        />
      </label>

      <button
        type="button"
        disabled={pending}
        onClick={() => void save()}
        className="self-start rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
        style={{ background: '#e6b800' }}
      >
        {pending ? 'saving…' : 'save branding'}
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
