'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

interface BrandingState {
  /** Stable CDN URL after upload — never edited by hand. */
  logoUrl: string;
  primaryColor: string;
  senderName: string;
  brandUrl: string;
  footerNote: string;
}

const DEFAULT: BrandingState = {
  logoUrl: '',
  primaryColor: '#00e87a',
  senderName: 'Briven Auth',
  brandUrl: '',
  footerNote: '',
};

const ACCEPT = '.svg,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp,image/svg+xml';
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const MAX_BYTES = 1024 * 1024; // 1 MiB — matches api

function sniffType(file: File): string {
  if (file.type && ALLOWED.has(file.type)) return file.type;
  const n = file.name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.svg')) return 'image/svg+xml';
  return file.type || '';
}

/**
 * briven-engine branding form — save via dashboard auth-core proxy.
 * Logo is upload-only (PNG / JPEG / WEBP / SVG). No URL paste field.
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
  const [logoPending, setLogoPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
          brandUrl?: string | null;
          footerNote?: string | null;
        };
        config?: {
          branding?: {
            logoUrl?: string | null;
            primaryColor?: string;
            senderName?: string;
            brandUrl?: string | null;
            footerNote?: string | null;
          };
        };
      };
      const b = body.branding ?? body.config?.branding;
      if (b) {
        setForm({
          logoUrl: b.logoUrl ?? '',
          primaryColor: b.primaryColor ?? DEFAULT.primaryColor,
          senderName: b.senderName ?? DEFAULT.senderName,
          brandUrl: b.brandUrl ?? '',
          footerNote: b.footerNote ?? '',
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

  async function uploadLogo(file: File): Promise<void> {
    if (!projectId) return;
    setLogoPending(true);
    setErr(null);
    setProof(null);
    try {
      const type = sniffType(file);
      if (!ALLOWED.has(type)) {
        throw new Error('logo must be .svg, .png, .jpg, .jpeg, or .webp');
      }
      if (file.size > MAX_BYTES) {
        throw new Error('logo must be 1 MB or smaller');
      }
      const data = new FormData();
      data.append('file', file, file.name);
      const res = await fetch(
        `/api/v1/projects/${encodeURIComponent(projectId)}/auth/branding/logo`,
        {
          method: 'POST',
          credentials: 'include',
          body: data,
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        logoUrl?: string;
        message?: string;
        code?: string;
      };
      if (!res.ok) {
        throw new Error(body.message ?? body.code ?? `upload failed (${res.status})`);
      }
      if (!body.logoUrl) throw new Error('upload returned no logo');
      setForm((f) => ({ ...f, logoUrl: body.logoUrl! }));
      setProof('logo uploaded — used in sign-in emails');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload failed');
    } finally {
      setLogoPending(false);
    }
  }

  async function removeLogo(): Promise<void> {
    if (!projectId) return;
    setLogoPending(true);
    setErr(null);
    setProof(null);
    try {
      const res = await fetch(
        `/api/v1/projects/${encodeURIComponent(projectId)}/auth/branding/logo`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        throw new Error(body.message ?? body.code ?? `remove failed (${res.status})`);
      }
      setForm((f) => ({ ...f, logoUrl: '' }));
      setProof('logo removed');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'remove failed');
    } finally {
      setLogoPending(false);
    }
  }

  async function save(): Promise<void> {
    if (!projectId) return;
    setPending(true);
    setErr(null);
    setProof(null);
    try {
      // logoUrl is never sent from a text field — only from prior upload.
      const payload = {
        primaryColor: form.primaryColor.trim() || DEFAULT.primaryColor,
        senderName: form.senderName.trim() || DEFAULT.senderName,
        brandUrl: form.brandUrl.trim() || null,
        footerNote: form.footerNote.trim() || null,
        // Keep current uploaded logo (do not clear on text save).
        logoUrl: form.logoUrl.trim() || null,
      };
      if (!/^#[0-9A-Fa-f]{6}$/.test(payload.primaryColor)) {
        throw new Error('primary color must be a 6-digit hex like #00e87a');
      }

      const url = engineMode
        ? `/api/dashboard/auth-core/projects/${encodeURIComponent(projectId)}/branding`
        : `/api/v1/projects/${projectId}/auth/config`;
      const res = await fetch(url, {
        method: engineMode ? 'PUT' : 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(engineMode ? payload : { branding: payload }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
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

  const brand = form.senderName || 'Briven Auth';
  const accent = /^#[0-9A-Fa-f]{6}$/.test(form.primaryColor)
    ? form.primaryColor
    : '#00e87a';
  const brandSite = form.brandUrl.trim().replace(/^https?:\/\//i, '') || null;

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

      {/* Live email preview — Flanders shell */}
      <div
        className="rounded-[14px] border p-6"
        style={{
          borderColor: '#2a2e36',
          background: '#13151a',
        }}
      >
        <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
          email preview
        </p>
        <div className="mb-5 flex items-center gap-2.5">
          {form.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.logoUrl}
              alt=""
              className="h-8 w-8 rounded-lg object-contain"
            />
          ) : (
            <span
              className="inline-block h-7 w-7 rounded-full"
              style={{
                background: accent,
                boxShadow: `0 0 0 3px ${accent}33`,
              }}
            />
          )}
          <span className="text-xl font-medium tracking-tight text-[#f5f7fa]">
            {brand}
          </span>
        </div>
        <h2 className="mb-3 text-lg font-medium text-[#f5f7fa]">
          sign in to {brand}
        </h2>
        <p className="mb-6 text-[15px] leading-relaxed text-[#9ba3af]">
          click the button below to sign in. this link expires in 10 minutes.
        </p>
        <span
          className="mb-6 inline-block rounded-[10px] px-6 py-3 text-sm font-medium text-[#0a0b0d]"
          style={{ background: accent }}
        >
          sign in
        </span>
        <p className="text-[13px] text-[#6b7280]">
          if you didn&apos;t request this, you can ignore this email.
        </p>
        <div className="mt-8 border-t border-[#1e2128] pt-4 text-[13px] leading-relaxed text-[#6b7280]">
          <p>
            {brand}
            {brandSite ? (
              <>
                {' · '}
                <span className="text-[#9ba3af]">{brandSite}</span>
              </>
            ) : null}
          </p>
          <p>
            made with <span className="text-[#e8344a]">♥</span> in Flanders by
            flndrn
          </p>
          <p>100% self-funded, sustainable &amp; independent</p>
          <p>flndrn Limited, Limassol, Cyprus</p>
        </div>
      </div>

      {/* Logo — upload only */}
      <div
        className="rounded-md border p-4"
        style={{ borderColor: 'var(--color-border-subtle)' }}
      >
        <p className="font-mono text-xs text-[var(--color-text)]">logo</p>
        <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
          upload .svg, .png, .jpg, .jpeg, or .webp (max 1 MB). shown next to
          the brand name in every Auth email. no link paste — upload only.
        </p>
        {form.logoUrl ? (
          <div className="mt-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={form.logoUrl}
              alt="current logo"
              className="h-10 w-auto max-w-[8rem] rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] object-contain p-1"
            />
            <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
              current logo
            </span>
          </div>
        ) : (
          <p className="mt-3 font-mono text-[11px] text-[var(--color-text-muted)]">
            no logo yet — preview uses a colored circle.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="max-w-full font-mono text-xs text-[var(--color-text)] file:mr-2 file:cursor-pointer file:rounded-md file:border-0 file:bg-[var(--color-surface)] file:px-3 file:py-2 file:font-mono file:text-xs file:text-[var(--color-text)]"
            disabled={logoPending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadLogo(f);
            }}
          />
          <button
            type="button"
            disabled={logoPending}
            onClick={() => fileRef.current?.click()}
            className="rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
            style={{ background: '#FFFD74' }}
          >
            {logoPending ? 'uploading…' : 'upload logo'}
          </button>
          {form.logoUrl ? (
            <button
              type="button"
              disabled={logoPending}
              onClick={() => void removeLogo()}
              className="rounded-md border px-4 py-2 font-mono text-xs text-[var(--color-text-muted)] disabled:opacity-50"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              remove
            </button>
          ) : null}
        </div>
      </div>

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
                : '#00e87a'
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
        <span className="text-[var(--color-text-muted)]">brand name</span>
        <input
          value={form.senderName}
          onChange={(e) =>
            setForm((f) => ({ ...f, senderName: e.target.value }))
          }
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        />
        <span className="text-[10px] text-[var(--color-text-muted)]">
          Shown as “sign in to …”, email From name, and footer.
        </span>
      </label>

      <label className="flex flex-col gap-1 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">
          brand website (footer link)
        </span>
        <input
          value={form.brandUrl}
          onChange={(e) =>
            setForm((f) => ({ ...f, brandUrl: e.target.value }))
          }
          placeholder="yourapp.com"
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        />
        <span className="text-[10px] text-[var(--color-text-muted)]">
          Optional. Footer shows “brand · site”.
        </span>
      </label>

      <label className="flex flex-col gap-1 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">
          footer note (optional)
        </span>
        <input
          value={form.footerNote}
          onChange={(e) =>
            setForm((f) => ({ ...f, footerNote: e.target.value }))
          }
          placeholder="Need help? support@yourapp.com"
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        />
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
