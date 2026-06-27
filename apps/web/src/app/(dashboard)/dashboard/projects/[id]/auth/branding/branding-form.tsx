'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface AuthConfig {
  providers: Record<string, unknown>; // opaque here — Providers panel owns this
  branding: {
    logoUrl: string | null;
    primaryColor: string;
    senderDomain: string | null;
    senderName: string;
  };
}

interface Props {
  projectId: string;
  initial: AuthConfig;
}

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Branding editor — logo, primary color, sender name, sender domain.
 * Client-side validation mirrors the server zod schema in
 * tenant-config-store.ts so save errors are rare; the API is still the
 * authoritative validator.
 *
 * mittera domain verification flow is intentionally NOT here — that's a
 * separate wizard (BUILD_PLAN.md §8) that walks the customer through
 * SPF/DKIM/return-path DNS records, then calls mittera's /v1/domains
 * endpoint. v0 here: customer types the domain they've already verified
 * (or wants to verify), saves, runs the wizard separately.
 */
export function BrandingForm({ projectId, initial }: Props) {
  const router = useRouter();
  const [branding, setBranding] = useState(initial.branding);
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Client-side validation. The API re-validates with zod; this just lets
  // the save button surface errors before the round-trip.
  const colorOk = HEX_RE.test(branding.primaryColor);
  const domainOk = branding.senderDomain === null || DOMAIN_RE.test(branding.senderDomain);
  const nameOk = branding.senderName.length > 0 && branding.senderName.length <= 64;
  const canSave = colorOk && domainOk && nameOk && !pending;

  async function save(): Promise<void> {
    setPending(true);
    setErrMsg(null);
    try {
      // `logoUrl` is owned exclusively by the LogoUploader (file upload +
      // serve route). Omit it here so a stale value in this form's state
      // can't clobber a freshly-uploaded logo on save.
      const { logoUrl: _ownedByUploader, ...brandingPatch } = branding;
      const res = await fetch(`/api/v1/projects/${projectId}/auth/config`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branding: brandingPatch }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
        };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      const body = (await res.json()) as { config: AuthConfig };
      setBranding(body.config.branding);
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'save failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* logo upload lives in <LogoUploader> (rendered by page.tsx) — it
          owns branding.logoUrl via the file-upload + serve route. */}
      <Card
        title="primary color"
        description="accent color on hosted login buttons + auth emails. WCAG-AA contrast against #0a0b0d (dark bg) recommended."
      >
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={branding.primaryColor}
            onChange={(e) => setBranding((b) => ({ ...b, primaryColor: e.target.value }))}
            className="h-9 w-12 cursor-pointer rounded-sm border border-[var(--color-border)] bg-transparent p-0"
          />
          <input
            type="text"
            value={branding.primaryColor}
            onChange={(e) => setBranding((b) => ({ ...b, primaryColor: e.target.value }))}
            placeholder="#00e87a"
            className="w-32 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
          <ColorPreview color={colorOk ? branding.primaryColor : '#00e87a'} />
        </div>
        {!colorOk ? (
          <p className="mt-1 font-mono text-[11px] text-[var(--color-error)]">
            must be a 6-digit hex (e.g. #00e87a)
          </p>
        ) : null}
      </Card>

      <Card
        title="sender name"
        description="display name on outbound auth emails. shown as `<sender name> <noreply@...>` in From:."
      >
        <input
          type="text"
          value={branding.senderName}
          onChange={(e) => setBranding((b) => ({ ...b, senderName: e.target.value }))}
          maxLength={64}
          className="w-full max-w-md rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
        />
        {!nameOk ? (
          <p className="mt-1 font-mono text-[11px] text-[var(--color-error)]">
            sender name must be between 1 and 64 characters
          </p>
        ) : null}
      </Card>

      <Card
        title="sender domain"
        description="mittera-verified domain for outbound auth emails. leave empty to use the briven fallback."
      >
        <input
          type="text"
          value={branding.senderDomain ?? ''}
          onChange={(e) =>
            setBranding((b) => ({ ...b, senderDomain: e.target.value.trim() || null }))
          }
          placeholder="mail.yourapp.com"
          className="w-full max-w-md rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
        />
        {branding.senderDomain && !domainOk ? (
          <p className="mt-1 font-mono text-[11px] text-[var(--color-error)]">
            invalid domain shape
          </p>
        ) : null}
        <p className="mt-2 font-mono text-[11px] text-[var(--color-text-subtle)]">
          verify your domain via the separate mittera DNS wizard (SPF + DKIM
          + return-path). until verified, mail still sends from{' '}
          <code>noreply@auth.briven.tech</code> regardless of this field.
        </p>
      </Card>

      <FromPreview
        senderName={branding.senderName}
        senderDomain={branding.senderDomain}
      />

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'saving…' : 'save branding'}
        </button>
        {errMsg ? (
          <span className="font-mono text-xs text-[var(--color-error)]">{errMsg}</span>
        ) : savedAt ? (
          <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
            saved · pool invalidated
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface CardProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

function Card({ title, description, children }: CardProps) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <h3 className="font-mono text-sm text-[var(--color-text)]">{title}</h3>
      <p className="mt-1 mb-3 font-mono text-[11px] text-[var(--color-text-muted)]">
        {description}
      </p>
      {children}
    </div>
  );
}

function ColorPreview({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-6 w-24 rounded-sm border border-[var(--color-border)]"
      style={{ background: color }}
      title={color}
    />
  );
}

function FromPreview({
  senderName,
  senderDomain,
}: {
  senderName: string;
  senderDomain: string | null;
}) {
  const domain = senderDomain ?? 'auth.briven.tech';
  const needsQuote = /[\s",;:<>@()\\[\]]/.test(senderName);
  const display = needsQuote ? `"${senderName}"` : senderName;
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-[11px] text-[var(--color-text-muted)]">
      <span className="text-[var(--color-text-subtle)]">From:</span>{' '}
      <span className="text-[var(--color-text)]">
        {display} &lt;noreply@{domain}&gt;
      </span>
      {senderDomain ? null : (
        <span className="ml-2 text-[var(--color-text-subtle)]">(fallback)</span>
      )}
    </div>
  );
}
