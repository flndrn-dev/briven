'use client';

import { useState } from 'react';

interface Props {
  apiOrigin: string;
}

interface TranslationResult {
  brivenSchema: string;
  warnings: string[];
  tables: { name: string; columns: number }[];
}

/**
 * Offline convex schema → briven schema DSL translator panel. The
 * operator pastes the customer's convex/schema.ts source (delivered
 * over email or screen-share during the migration call), the panel
 * sends it to /v1/admin/translate-convex-schema and renders the
 * draft briven/schema.ts plus per-column warnings the operator
 * needs to resolve before deploy.
 *
 * Read-only operation — no step-up required, no audit log entry
 * needed. Pure transform of input the operator already has.
 */
export function ConvexTranslator({ apiOrigin }: Props) {
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    if (!source.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/translate-convex-schema`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `translate failed: ${res.status}`);
      }
      const data = (await res.json()) as TranslationResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'translate failed');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.brivenSchema);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — operator can manual-select
    }
  }

  return (
    <details className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-xs">
      <summary className="cursor-pointer text-[var(--color-text)]">
        translate convex schema → briven DSL
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-[var(--color-text-subtle)]">
          paste the customer&apos;s convex/schema.ts source here. handles defineTable
          with v.string / v.number / v.int64 / v.boolean / v.id / v.optional /
          v.union / v.array / v.object. unrecognised types emit text() + a TODO.
        </p>
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={8}
          maxLength={100_000}
          placeholder="import { defineTable, defineSchema, v } from 'convex/schema';\nexport default defineSchema({ notes: defineTable({ ... }) });"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || !source.trim()}
            className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
          >
            {busy ? 'translating…' : 'translate'}
          </button>
          {result ? (
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
            >
              {copied ? 'copied' : 'copy briven schema'}
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="text-[var(--color-error)]">{error}</p>
        ) : null}
        {result ? (
          <div className="flex flex-col gap-3">
            <p className="text-[10px] text-[var(--color-text-subtle)]">
              {result.tables.length} table{result.tables.length === 1 ? '' : 's'} parsed
              {result.tables.length > 0
                ? `: ${result.tables.map((t) => `${t.name}(${t.columns})`).join(', ')}`
                : ''}
            </p>
            {result.warnings.length > 0 ? (
              <div className="rounded-md border border-[var(--color-warning)] bg-[var(--color-warning)]/5 p-2">
                <p className="font-medium text-[var(--color-warning)]">
                  {result.warnings.length} warning
                  {result.warnings.length === 1 ? '' : 's'}
                </p>
                <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-[var(--color-text-muted)]">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <pre className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-3 text-[11px] text-[var(--color-text)]">
              <code>{result.brivenSchema}</code>
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}
