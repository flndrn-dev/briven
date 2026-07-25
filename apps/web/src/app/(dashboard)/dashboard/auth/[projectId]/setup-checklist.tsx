'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type SetupStep = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  href?: string;
};

type SetupStatus = {
  complete: boolean;
  steps: SetupStep[];
  appOrigins: string[];
  activeKeyCount: number;
  apiOrigin: string;
  proxySnippet: string;
};

export function AuthSetupChecklist({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [mintedKey, setMintedKey] = useState<string | null>(null);
  const [productionOrigin, setProductionOrigin] = useState('https://');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/dashboard/auth-core/projects/${encodeURIComponent(projectId)}/setup-status`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? `load failed (${res.status})`);
      }
      const body = (await res.json()) as SetupStatus;
      setStatus(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not load setup status');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function finish(): Promise<void> {
    setBusy(true);
    setErr(null);
    setNote(null);
    setMintedKey(null);
    try {
      const origin =
        productionOrigin.trim() &&
        productionOrigin.trim() !== 'https://' &&
        productionOrigin.trim() !== 'http://'
          ? productionOrigin.trim()
          : undefined;
      const res = await fetch(
        `/api/dashboard/auth-core/projects/${encodeURIComponent(projectId)}/setup-finish`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            origin ? { productionOrigin: origin } : {},
          ),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
        actions?: string[];
        mintedKeyPlaintext?: string | null;
        status?: SetupStatus;
      };
      if (!res.ok) {
        throw new Error(body.message ?? body.code ?? `failed (${res.status})`);
      }
      if (body.status) setStatus(body.status);
      if (body.mintedKeyPlaintext) setMintedKey(body.mintedKeyPlaintext);
      setNote(
        body.actions?.length
          ? body.actions.join(' · ')
          : 'setup finished',
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'finish setup failed');
    } finally {
      setBusy(false);
    }
  }

  async function copyKey(): Promise<void> {
    if (!mintedKey) return;
    try {
      await navigator.clipboard.writeText(mintedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr('could not copy — select the key and copy manually');
    }
  }

  if (loading && !status) {
    return (
      <div className="rounded-md border border-[var(--color-border-subtle)] p-6 font-mono text-xs text-[var(--color-text-muted)]">
        checking Auth setup…
      </div>
    );
  }

  if (!status) {
    return err ? (
      <p className="font-mono text-xs text-red-400">{err}</p>
    ) : null;
  }

  // When complete, hide the big checklist (overview shows normal stats).
  if (status.complete && !mintedKey) {
    return (
      <div
        className="rounded-md border px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]"
        style={{ borderColor: 'color-mix(in srgb, #FFFD74 35%, transparent)' }}
      >
        <span style={{ color: 'var(--auth-accent, #FFFD74)' }}>✓</span> Auth
        setup complete for this project
        {status.appOrigins.length
          ? ` · ${status.appOrigins.join(', ')}`
          : ''}
      </div>
    );
  }

  return (
    <div
      className="rounded-md border p-5"
      style={{
        borderColor: 'color-mix(in srgb, #FFFD74 40%, transparent)',
        background: 'color-mix(in srgb, #FFFD74 4%, transparent)',
      }}
    >
      <h2 className="font-mono text-sm text-[var(--color-text)]">
        get Auth ready
      </h2>
      <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
        one path for apps like Konnos / Mavi — finish these steps so login
        works the first time
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {status.steps.map((step) => (
          <li
            key={step.id}
            className="flex items-start gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs"
          >
            <span
              className="mt-0.5 shrink-0"
              style={{
                color: step.ok
                  ? 'var(--auth-accent, #FFFD74)'
                  : 'var(--color-text-muted)',
              }}
              aria-hidden
            >
              {step.ok ? '✓' : '○'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-[var(--color-text)]">{step.label}</span>
              <span className="mt-0.5 block text-[10px] text-[var(--color-text-muted)]">
                {step.detail}
              </span>
              {step.href && !step.ok ? (
                <Link
                  href={step.href}
                  className="mt-1 inline-block text-[10px] underline"
                  style={{ color: 'var(--auth-accent, #FFFD74)' }}
                >
                  open →
                </Link>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      <label className="mt-4 flex flex-col gap-1 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">
          live app URL (optional — also seeds localhost for local dev)
        </span>
        <input
          value={productionOrigin}
          onChange={(e) => setProductionOrigin(e.target.value)}
          placeholder="https://pay.yourapp.com"
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2"
          style={{ borderColor: 'var(--auth-accent-border, #333)' }}
        />
      </label>

      <button
        type="button"
        disabled={busy}
        onClick={() => void finish()}
        className="mt-4 rounded-md px-4 py-2.5 font-mono text-xs font-medium text-black disabled:opacity-50"
        style={{ background: '#FFFD74' }}
      >
        {busy ? 'finishing…' : 'Finish setup'}
      </button>
      <p className="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
        turns Auth on · core methods · localhost origin · mints a browser key
        if you don’t have one
      </p>

      {mintedKey ? (
        <div className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
            browser key — copy now (shown once)
          </p>
          <code className="mt-2 block break-all font-mono text-[11px] text-[var(--color-text)]">
            {mintedKey}
          </code>
          <button
            type="button"
            onClick={() => void copyKey()}
            className="mt-2 font-mono text-[10px] underline"
            style={{ color: 'var(--auth-accent, #FFFD74)' }}
          >
            {copied ? 'copied' : 'copy key'}
          </button>
          <p className="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
            put in app env as{' '}
            <code className="text-[var(--color-text)]">
              NEXT_PUBLIC_BRIVEN_AUTH_KEY
            </code>
          </p>
        </div>
      ) : null}

      {!status.steps.find((s) => s.id === 'proxy')?.ok ? (
        <div className="mt-4 rounded-md border border-dashed border-[var(--color-border)] p-3">
          <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
            proxy snippet (your app, not Briven)
          </p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-[var(--color-text)]">
            {status.proxySnippet}
          </pre>
        </div>
      ) : null}

      {note ? (
        <p
          className="mt-3 font-mono text-xs"
          style={{ color: 'var(--auth-accent, #FFFD74)' }}
        >
          {note}
        </p>
      ) : null}
      {err ? (
        <p className="mt-3 font-mono text-xs text-red-400">{err}</p>
      ) : null}
    </div>
  );
}
