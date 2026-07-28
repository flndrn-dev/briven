'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

interface BrandingState {
  /** Stable CDN URL after upload — never edited by hand. */
  logoUrl: string;
  primaryColor: string;
  senderName: string;
  /** Domain for From address, e.g. pando.so → noreply@pando.so */
  senderDomain: string;
  /** Local part before @ (default noreply) */
  senderLocalPart: string;
  /** Full From email override (wins over local@domain) */
  senderEmail: string;
  brandUrl: string;
  footerNote: string;
  /** Email footer line 1: made with ♥ {loveName} by {orgName} */
  footerLoveName: string;
  footerOrgName: string;
  /** Email footer line 2 free text */
  footerTagline: string;
  footerCity: string;
  footerCountry: string;
  footerShowLove: boolean;
  footerShowTagline: boolean;
  footerShowAddress: boolean;
}

const DEFAULT: BrandingState = {
  logoUrl: '',
  primaryColor: '#00e87a',
  senderName: 'Briven Auth',
  senderDomain: '',
  senderLocalPart: 'noreply',
  senderEmail: '',
  brandUrl: '',
  footerNote: '',
  footerLoveName: '',
  footerOrgName: '',
  footerTagline: '',
  footerCity: '',
  footerCountry: '',
  footerShowLove: false,
  footerShowTagline: false,
  footerShowAddress: false,
};

/** Live From: preview matching server buildAuthEmailFromHeader. */
function previewFromHeader(f: BrandingState): string {
  const name = f.senderName.trim() || 'Briven Auth';
  const needsQuote = /[\s",;:<>@()\\[\]]/.test(name);
  const display = needsQuote ? `"${name}"` : name;
  const full = f.senderEmail.trim().toLowerCase();
  if (full.includes('@')) return `${display} <${full}>`;
  const domain = f.senderDomain
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/^https?:\/\//, '')
    .split('/')[0];
  if (domain) {
    const local = (f.senderLocalPart.trim() || 'noreply').toLowerCase();
    return `${display} <${local}@${domain}>`;
  }
  return `${display} <noreply@briven.tech>`;
}

/** Preview lines matching server buildAuthEmailFooterLines. */
function previewFooterLines(f: BrandingState): string[] {
  const lines: string[] = [];
  const org = f.footerOrgName.trim();
  const love = f.footerLoveName.trim();
  const tag = f.footerTagline.trim();
  const city = f.footerCity.trim();
  const country = f.footerCountry.trim();
  if (f.footerShowLove) {
    if (love && org) lines.push(`made with ♥ ${love} by ${org}`);
    else if (love) lines.push(`made with ♥ ${love}`);
    else if (org) lines.push(`made with ♥ by ${org}`);
  }
  if (f.footerShowTagline && tag) lines.push(tag);
  if (f.footerShowAddress) {
    const parts = [org, city, country].filter(Boolean);
    if (parts.length) lines.push(parts.join(', '));
  }
  return lines;
}

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

function applyBrandingPayload(
  b: Partial<BrandingState> & {
    logoUrl?: string | null;
    brandUrl?: string | null;
    footerNote?: string | null;
    footerLoveName?: string | null;
    footerOrgName?: string | null;
    footerTagline?: string | null;
    footerCity?: string | null;
    footerCountry?: string | null;
    footerShowLove?: boolean;
    footerShowTagline?: boolean;
    footerShowAddress?: boolean;
    senderDomain?: string | null;
    senderLocalPart?: string | null;
    senderEmail?: string | null;
  },
): BrandingState {
  return {
    logoUrl: b.logoUrl ?? '',
    primaryColor: b.primaryColor ?? DEFAULT.primaryColor,
    senderName: b.senderName ?? DEFAULT.senderName,
    senderDomain: b.senderDomain ?? '',
    senderLocalPart: b.senderLocalPart ?? DEFAULT.senderLocalPart,
    senderEmail: b.senderEmail ?? '',
    brandUrl: b.brandUrl ?? '',
    footerNote: b.footerNote ?? '',
    footerLoveName: b.footerLoveName ?? '',
    footerOrgName: b.footerOrgName ?? '',
    footerTagline: b.footerTagline ?? '',
    footerCity: b.footerCity ?? '',
    footerCountry: b.footerCountry ?? '',
    footerShowLove: Boolean(b.footerShowLove),
    footerShowTagline: Boolean(b.footerShowTagline),
    footerShowAddress: Boolean(b.footerShowAddress),
  };
}

/**
 * briven-engine branding form.
 * - Logo: upload-only via dashboard auth-core proxy (cookies + Origin).
 * - Settings: PUT branding (does not clear logo).
 */
export function AuthBrandingClient({
  projects,
  lockProjectId,
  engineMode = true,
}: {
  projects: AuthV2ProjectRow[];
  lockProjectId?: string;
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
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (id: string) => {
      if (!id) return;
      setLoading(true);
      setErr(null);
      try {
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
          const body = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          setErr(body.message ?? `load failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as {
          branding?: Partial<BrandingState> & {
            logoUrl?: string | null;
            brandUrl?: string | null;
            footerNote?: string | null;
          };
          config?: {
            branding?: Partial<BrandingState> & {
              logoUrl?: string | null;
              brandUrl?: string | null;
              footerNote?: string | null;
            };
          };
        };
        const b = body.branding ?? body.config?.branding;
        if (b) {
          setForm(applyBrandingPayload(b));
        } else {
          setForm(DEFAULT);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'load failed');
      } finally {
        setLoading(false);
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
      // Briven Auth only: /v1/auth-core/* via dashboard proxy (cookies + Origin).
      // Do NOT fall back to /v1/projects/:id/auth/* — that surface is retired (410).
      const path = `/api/dashboard/auth-core/projects/${encodeURIComponent(projectId)}/branding/logo`;
      const data = new FormData();
      data.append('file', file, file.name);
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        body: data,
      });
      const body = (await res.json().catch(() => ({}))) as {
        logoUrl?: string;
        branding?: Partial<BrandingState> & {
          logoUrl?: string | null;
          brandUrl?: string | null;
          footerNote?: string | null;
        };
        message?: string;
        code?: string;
      };
      if (!res.ok || !body.logoUrl) {
        throw new Error(
          body.message ?? body.code ?? `upload failed (${res.status})`,
        );
      }
      const logoUrl = body.logoUrl;
      const branding = body.branding ?? null;

      setForm((f) =>
        branding
          ? applyBrandingPayload({ ...f, ...branding, logoUrl })
          : { ...f, logoUrl },
      );
      setProof(`logo uploaded (${file.name}) — used in sign-in emails`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload failed');
    } finally {
      setLogoPending(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo(): Promise<void> {
    if (!projectId) return;
    setLogoPending(true);
    setErr(null);
    setProof(null);
    try {
      const path = `/api/dashboard/auth-core/projects/${encodeURIComponent(projectId)}/branding/logo`;
      const res = await fetch(path, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        throw new Error(
          body.message ?? body.code ?? `remove failed (${res.status})`,
        );
      }
      setForm((f) => ({ ...f, logoUrl: '' }));
      setProof('logo removed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'remove failed');
    } finally {
      setLogoPending(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save(): Promise<void> {
    if (!projectId) return;
    setPending(true);
    setErr(null);
    setProof(null);
    try {
      // Never send logoUrl here — upload/remove own that field so save
      // cannot wipe a logo after a partial load.
      const payload = {
        primaryColor: form.primaryColor.trim() || DEFAULT.primaryColor,
        senderName: form.senderName.trim() || DEFAULT.senderName,
        senderDomain: form.senderDomain.trim() || null,
        senderLocalPart: form.senderLocalPart.trim() || null,
        senderEmail: form.senderEmail.trim() || null,
        brandUrl: form.brandUrl.trim() || null,
        footerNote: form.footerNote.trim() || null,
        footerLoveName: form.footerLoveName.trim() || null,
        footerOrgName: form.footerOrgName.trim() || null,
        footerTagline: form.footerTagline.trim() || null,
        footerCity: form.footerCity.trim() || null,
        footerCountry: form.footerCountry.trim() || null,
        footerShowLove: form.footerShowLove,
        footerShowTagline: form.footerShowTagline,
        footerShowAddress: form.footerShowAddress,
      };
      if (!/^#[0-9A-Fa-f]{6}$/.test(payload.primaryColor)) {
        throw new Error('primary color must be a 6-digit hex like #00e87a');
      }
      if (!payload.senderName.trim()) {
        throw new Error('brand name is required');
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
        branding?: Partial<BrandingState> & {
          logoUrl?: string | null;
          brandUrl?: string | null;
          footerNote?: string | null;
        };
        config?: {
          branding?: Partial<BrandingState> & {
            logoUrl?: string | null;
            brandUrl?: string | null;
            footerNote?: string | null;
          };
        };
      };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);

      const saved = body.branding ?? body.config?.branding;
      if (saved) {
        // Keep current logo if response omits it
        setForm(
          applyBrandingPayload({
            ...saved,
            logoUrl: saved.logoUrl ?? form.logoUrl,
          }),
        );
      }
      setProof(
        `saved · “${payload.senderName}” · From: ${previewFromHeader(form)} — refresh keeps these settings`,
      );
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
  const footerPreview = previewFooterLines(form);

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

      {loading ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          loading saved branding…
        </p>
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
        <div className="mt-8 border-t border-[#1e2128] pt-4 text-[12px] leading-relaxed text-[#6b7280]">
          <p>
            {brand}
            {brandSite ? (
              <>
                {' · '}
                <span className="text-[#9ba3af]">{brandSite}</span>
              </>
            ) : null}
          </p>
          {footerPreview.length === 0 ? (
            <p className="mt-1 text-[11px] text-[#555]">
              (no custom footer lines yet — turn them on below)
            </p>
          ) : (
            footerPreview.map((line) => (
              <p key={line}>
                {line.includes('♥') ? (
                  <>
                    {line.split('♥')[0]}
                    <span className="text-[#e8344a]">♥</span>
                    {line.split('♥').slice(1).join('♥')}
                  </>
                ) : (
                  line
                )}
              </p>
            ))
          )}
        </div>
      </div>

      {/* Logo — one clear upload control */}
      <div
        className="rounded-md border p-4"
        style={{ borderColor: 'var(--color-border-subtle)' }}
      >
        <p className="font-mono text-xs text-[var(--color-text)]">logo</p>
        <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
          Click “choose logo file”, pick .svg / .png / .jpg / .jpeg / .webp
          (max 1 MB). Upload starts automatically after you pick.
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
              current logo (saved)
            </span>
          </div>
        ) : (
          <p className="mt-3 font-mono text-[11px] text-[var(--color-text-muted)]">
            no logo yet — preview uses a colored circle.
          </p>
        )}
        {/* Hidden real input — button triggers it, pick auto-uploads */}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          disabled={logoPending}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadLogo(f);
          }}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={logoPending || loading}
            onClick={() => fileRef.current?.click()}
            className="rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
            style={{ background: '#FFFD74' }}
          >
            {logoPending ? 'uploading…' : 'choose logo file'}
          </button>
          {form.logoUrl ? (
            <button
              type="button"
              disabled={logoPending}
              onClick={() => void removeLogo()}
              className="rounded-md border px-4 py-2 font-mono text-xs text-[var(--color-text-muted)] disabled:opacity-50"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              remove logo
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
          placeholder="Pando"
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        />
        <span className="text-[10px] text-[var(--color-text-muted)]">
          Shown as “sign in to …”, mailbox display name (From:), and footer.
        </span>
      </label>

      {/* Per-project From: — SuperTokens-style sender (not always briven.tech) */}
      <div
        className="flex flex-col gap-3 rounded-md border p-4"
        style={{ borderColor: 'var(--color-border-subtle)' }}
      >
        <div>
          <p className="font-mono text-xs text-[var(--color-text)]">
            email From address
          </p>
          <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
            What your users see in Outlook/Gmail as the sender. Example for
            Pando: name <strong>Pando</strong> + domain{' '}
            <strong>pando.so</strong> →{' '}
            <code className="text-[var(--color-text)]">
              Pando &lt;noreply@pando.so&gt;
            </code>
            . Domain must be allowed on your mail provider (SPF/DKIM).
          </p>
        </div>
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">
            sender domain (e.g. pando.so)
          </span>
          <input
            value={form.senderDomain}
            onChange={(e) =>
              setForm((f) => ({ ...f, senderDomain: e.target.value }))
            }
            placeholder="pando.so"
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
        </label>
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">
            local part before @ (default noreply)
          </span>
          <input
            value={form.senderLocalPart}
            onChange={(e) =>
              setForm((f) => ({ ...f, senderLocalPart: e.target.value }))
            }
            placeholder="noreply"
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
        </label>
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">
            full From email (optional override)
          </span>
          <input
            value={form.senderEmail}
            onChange={(e) =>
              setForm((f) => ({ ...f, senderEmail: e.target.value }))
            }
            placeholder="auth@pando.so"
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
          <span className="text-[10px] text-[var(--color-text-muted)]">
            If set, this full address wins over local@domain.
          </span>
        </label>
        <p
          className="rounded-md border px-3 py-2 font-mono text-[11px] text-[var(--color-text)]"
          style={{
            borderColor: 'var(--auth-accent-border)',
            background: 'var(--color-surface)',
          }}
        >
          <span className="text-[var(--color-text-muted)]">preview From: </span>
          {previewFromHeader(form)}
        </p>
      </div>

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
        <span className="text-[10px] text-[var(--color-text-muted)]">
          Small line above the footer (e.g. support email).
        </span>
      </label>

      {/* Custom email footer — 3 optional lines */}
      <div
        className="flex flex-col gap-3 rounded-md border p-4"
        style={{ borderColor: 'var(--color-border-subtle)' }}
      >
        <div>
          <p className="font-mono text-xs text-[var(--color-text)]">
            email footer lines
          </p>
          <p className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
            Fill in your own text, then tick which lines to show in sign-in
            emails. Nothing is hard-coded to flndrn — leave toggles off to hide
            a line.
          </p>
        </div>

        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">
            organization name
          </span>
          <input
            value={form.footerOrgName}
            onChange={(e) =>
              setForm((f) => ({ ...f, footerOrgName: e.target.value }))
            }
            placeholder="e.g. Mavi Finance Ltd"
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
        </label>

        <div className="rounded-md border border-[var(--color-border-subtle)] p-3">
          <label className="flex items-center gap-2 font-mono text-xs text-[var(--color-text)]">
            <input
              type="checkbox"
              checked={form.footerShowLove}
              onChange={(e) =>
                setForm((f) => ({ ...f, footerShowLove: e.target.checked }))
              }
            />
            show line 1 — made with ♥ {'{name}'} by {'{organization}'}
          </label>
          <label className="mt-2 flex flex-col gap-1 font-mono text-xs">
            <span className="text-[var(--color-text-muted)]">
              name (place or short phrase)
            </span>
            <input
              value={form.footerLoveName}
              onChange={(e) =>
                setForm((f) => ({ ...f, footerLoveName: e.target.value }))
              }
              placeholder="e.g. Flanders"
              disabled={!form.footerShowLove}
              className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)] disabled:opacity-40"
              style={{ borderColor: 'var(--auth-accent-border)' }}
            />
          </label>
        </div>

        <div className="rounded-md border border-[var(--color-border-subtle)] p-3">
          <label className="flex items-center gap-2 font-mono text-xs text-[var(--color-text)]">
            <input
              type="checkbox"
              checked={form.footerShowTagline}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  footerShowTagline: e.target.checked,
                }))
              }
            />
            show line 2 — free text
          </label>
          <label className="mt-2 flex flex-col gap-1 font-mono text-xs">
            <span className="text-[var(--color-text-muted)]">line text</span>
            <input
              value={form.footerTagline}
              onChange={(e) =>
                setForm((f) => ({ ...f, footerTagline: e.target.value }))
              }
              placeholder="e.g. 100% self-funded, sustainable & independent"
              disabled={!form.footerShowTagline}
              className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)] disabled:opacity-40"
              style={{ borderColor: 'var(--auth-accent-border)' }}
            />
          </label>
        </div>

        <div className="rounded-md border border-[var(--color-border-subtle)] p-3">
          <label className="flex items-center gap-2 font-mono text-xs text-[var(--color-text)]">
            <input
              type="checkbox"
              checked={form.footerShowAddress}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  footerShowAddress: e.target.checked,
                }))
              }
            />
            show line 3 — organization, city, country
          </label>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 font-mono text-xs">
              <span className="text-[var(--color-text-muted)]">city</span>
              <input
                value={form.footerCity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, footerCity: e.target.value }))
                }
                placeholder="e.g. Limassol"
                disabled={!form.footerShowAddress}
                className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)] disabled:opacity-40"
                style={{ borderColor: 'var(--auth-accent-border)' }}
              />
            </label>
            <label className="flex flex-col gap-1 font-mono text-xs">
              <span className="text-[var(--color-text-muted)]">country</span>
              <input
                value={form.footerCountry}
                onChange={(e) =>
                  setForm((f) => ({ ...f, footerCountry: e.target.value }))
                }
                placeholder="e.g. Cyprus"
                disabled={!form.footerShowAddress}
                className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)] disabled:opacity-40"
                style={{ borderColor: 'var(--auth-accent-border)' }}
              />
            </label>
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={pending || loading}
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
