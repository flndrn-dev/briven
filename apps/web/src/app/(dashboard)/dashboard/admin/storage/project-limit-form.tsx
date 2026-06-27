'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '../../../../../components/step-up-prompt';

interface Props {
  apiOrigin: string;
  projectId: string;
  projectName: string;
  hasOverride: boolean;
  /** Effective limits in force now (override value if set, else the tier cap). */
  effectiveMaxRows: number;
  effectiveMaxTables: number;
  /** Tier cap the project inherits when no override is set — shown as placeholder. */
  tierMaxRows: number;
  tierMaxTables: number;
}

type Body = { maxRows: number | null; maxTables: number | null };

/**
 * Per-project storage-limit editor. PATCHes
 * /v1/admin/storage/projects/:id with an override, or clears it (null,null)
 * so the project inherits its tier cap again. Collapsed by default to keep
 * the usage table scannable; the override badge in the row already shows
 * which projects carry a custom limit. Step-up gated like the tier-cap
 * editor — 403 step_up_required surfaces the inline password prompt and we
 * retry the same intent (set or clear).
 */
export function ProjectLimitForm({
  apiOrigin,
  projectId,
  projectName,
  hasOverride,
  effectiveMaxRows,
  effectiveMaxTables,
  tierMaxRows,
  tierMaxTables,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Prefill with the current override when one exists; otherwise leave blank
  // so empty inputs read as "inherit the tier cap".
  const [rows, setRows] = useState(hasOverride ? String(effectiveMaxRows) : '');
  const [tables, setTables] = useState(hasOverride ? String(effectiveMaxTables) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Body | null>(null);
  const [, startTransition] = useTransition();

  function parseField(value: string): number | null | 'invalid' {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) return 'invalid';
    return n;
  }

  async function send(body: Body) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiOrigin}/v1/admin/storage/projects/${encodeURIComponent(projectId)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (res.status === 403) {
        const parsed = (await res.json().catch(() => null)) as { code?: string } | null;
        if (parsed?.code === 'step_up_required') {
          setPending(body);
          return;
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `save failed: ${res.status}`);
      }
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setBusy(false);
    }
  }

  function onSave() {
    const maxRows = parseField(rows);
    const maxTables = parseField(tables);
    if (maxRows === 'invalid' || maxTables === 'invalid') {
      setError('whole non-negative numbers, or blank to inherit');
      return;
    }
    void send({ maxRows, maxTables });
  }

  function onClear() {
    setRows('');
    setTables('');
    void send({ maxRows: null, maxTables: null });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        set limit
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] text-[var(--color-text-muted)]">rows</span>
          <input
            type="number"
            min={0}
            step={1}
            value={rows}
            onChange={(e) => setRows(e.target.value)}
            placeholder={`tier: ${tierMaxRows.toLocaleString()}`}
            disabled={busy}
            className="w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] text-[var(--color-text-muted)]">tables</span>
          <input
            type="number"
            min={0}
            step={1}
            value={tables}
            onChange={(e) => setTables(e.target.value)}
            placeholder={`tier: ${tierMaxTables.toLocaleString()}`}
            disabled={busy}
            className="w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="rounded-md border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] px-3 py-1 font-mono text-xs text-[var(--color-primary)] hover:bg-[var(--color-primary)]/15 disabled:opacity-50"
        >
          {busy ? 'saving…' : 'save'}
        </button>
        {hasOverride ? (
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] px-3 py-1 font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            clear override
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
        >
          cancel
        </button>
      </div>
      <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
        blank inherits the tier cap. both fields are sent together.
      </p>
      {error ? (
        <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p>
      ) : null}
      {pending != null ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason={`changing the storage limit for ${projectName} requires fresh step-up auth.`}
          onSuccess={async () => {
            const body = pending;
            setPending(null);
            await send(body);
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
