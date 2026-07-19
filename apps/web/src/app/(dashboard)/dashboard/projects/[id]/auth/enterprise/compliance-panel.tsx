'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { EnterpriseCopyButton } from './enterprise-copy-button';

interface ComplianceSettings {
  soc2ControlsUrl: string | null;
  hipaaBaaSignedAt: string | null;
  hipaaBaaSignedBy: string | null;
  gdprDpaSignedAt: string | null;
  gdprDpaSignedBy: string | null;
  encryptionAtRestEnabled: boolean;
}

interface EnterprisePack {
  packVersion: string;
  projectId: string;
  generatedAt: string;
  compliance: ComplianceSettings;
  retention: { auditLogDays: number | null; appLogDays: number | null };
  capabilities: Record<string, boolean>;
  endpoints: {
    scimBase: string;
    samlMetadataPattern: string;
    oidcStartPattern: string;
    complianceApi: string;
    compliancePackApi: string;
  };
  checklistForSales: Array<{ id: string; label: string; done: boolean }>;
  templates?: unknown;
}

interface Props {
  projectId: string;
  pack: EnterprisePack | null;
}

export function CompliancePanel({ projectId, pack }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<'dpa' | 'baa' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedBy, setSignedBy] = useState('');

  async function sign(kind: 'dpa' | 'baa'): Promise<void> {
    setPending(kind);
    setErr(null);
    try {
      const path =
        kind === 'dpa'
          ? `/api/v1/projects/${projectId}/auth/compliance/sign-dpa`
          : `/api/v1/projects/${projectId}/auth/compliance/sign-baa`;
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          signedBy: signedBy.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'sign failed');
    } finally {
      setPending(null);
    }
  }

  function downloadPack(): void {
    if (!pack) return;
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `briven-enterprise-pack-${projectId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!pack) {
    return (
      <div className="rounded-md border border-[var(--color-border-subtle)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        compliance pack could not be loaded. try again after deploy, or check you are an admin on
        this project.
      </div>
    );
  }

  const c = pack.compliance;

  return (
    <div className="flex flex-col gap-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-mono text-sm text-[var(--color-text)]">compliance pack</h3>
          <p className="mt-1 max-w-xl font-mono text-[11px] text-[var(--color-text-muted)]">
            Sales / legal kit for this project (DPA template, retention notes, checklist). Download
            the JSON for your lawyer. Mark DPA/BAA only after a real signature.
          </p>
          <p className="mt-1 font-mono text-[10px] text-[var(--color-text-subtle)]">
            pack {pack.packVersion} · generated {pack.generatedAt.slice(0, 19)}Z
          </p>
        </div>
        <button
          type="button"
          onClick={downloadPack}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)]"
        >
          download pack JSON
        </button>
      </div>

      <ul className="flex flex-col gap-1.5">
        {pack.checklistForSales.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-2 font-mono text-xs text-[var(--color-text)]"
          >
            <span
              className={
                item.done ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'
              }
              aria-hidden
            >
              {item.done ? '☑' : '☐'}
            </span>
            <span className={item.done ? '' : 'text-[var(--color-text-muted)]'}>{item.label}</span>
          </li>
        ))}
      </ul>

      <div className="grid gap-2 font-mono text-[11px] text-[var(--color-text-muted)] sm:grid-cols-2">
        <p>
          GDPR DPA:{' '}
          {c.gdprDpaSignedAt
            ? `signed ${c.gdprDpaSignedAt.slice(0, 10)}${c.gdprDpaSignedBy ? ` · ${c.gdprDpaSignedBy}` : ''}`
            : 'not recorded'}
        </p>
        <p>
          HIPAA BAA:{' '}
          {c.hipaaBaaSignedAt
            ? `signed ${c.hipaaBaaSignedAt.slice(0, 10)}${c.hipaaBaaSignedBy ? ` · ${c.hipaaBaaSignedBy}` : ''}`
            : 'not recorded'}
        </p>
        <p>encryption at rest: {c.encryptionAtRestEnabled ? 'yes' : 'no'}</p>
        <p>
          log retention: audit {pack.retention.auditLogDays ?? '—'}d · app{' '}
          {pack.retention.appLogDays ?? '—'}d
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-3">
        <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
          <span>signed by (name / company) — optional</span>
          <input
            type="text"
            value={signedBy}
            onChange={(e) => setSignedBy(e.target.value)}
            placeholder="e.g. Jane Doe, Acme Corp"
            className="max-w-md rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void sign('dpa')}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
          >
            {pending === 'dpa' ? 'saving…' : 'record DPA signed'}
          </button>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void sign('baa')}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
          >
            {pending === 'baa' ? 'saving…' : 'record BAA signed'}
          </button>
          <a
            href="/trust"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >
            open public trust page ↗
          </a>
        </div>
        {err ? <p className="font-mono text-xs text-[var(--color-error)]">{err}</p> : null}
        <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          Owner role required to record signatures. Templates in the pack are not a substitute for
          legal counsel.
        </p>
      </div>

      <div className="font-mono text-[10px] text-[var(--color-text-subtle)]">
        pack API: <code className="text-[var(--color-text-muted)]">{pack.endpoints.compliancePackApi}</code>{' '}
        <EnterpriseCopyButton value={pack.endpoints.compliancePackApi} label="copy" />
      </div>
    </div>
  );
}
