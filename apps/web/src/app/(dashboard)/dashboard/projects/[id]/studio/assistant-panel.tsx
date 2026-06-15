'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface PlannedColumn {
  name: string;
  type: string;
  notNull: boolean;
}
interface PlannedTable {
  name: string;
  description: string;
  columns: PlannedColumn[];
  sampleRows: Record<string, unknown>[];
}
interface AssistantPlan {
  summary: string;
  tables: PlannedTable[];
}

// Plain-English names for the raw types (mirrors new-table-form).
const TYPE_LABELS: Record<string, string> = {
  text: 'text',
  integer: 'whole number',
  bigint: 'whole number',
  boolean: 'yes / no',
  timestamptz: 'date & time',
  jsonb: 'data',
  uuid: 'link',
  numeric: 'decimal',
};

const EXAMPLES = [
  'Track my customers and the orders they place',
  'A simple CRM with companies, contacts and deals',
  'Inventory for my shop: products, suppliers and stock counts',
];

export function AssistantPanel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [phase, setPhase] = useState<'idle' | 'planning' | 'applying'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function design(e: FormEvent) {
    e.preventDefault();
    if (prompt.trim() === '') return;
    setError(null);
    setDone(null);
    setPlan(null);
    setPhase('planning');
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/studio/assistant/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const body = (await res.json().catch(() => ({}))) as { plan?: AssistantPlan; message?: string };
      if (!res.ok) throw new Error(body.message ?? `the assistant couldn't help just now (${res.status})`);
      setPlan(body.plan ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
    } finally {
      setPhase('idle');
    }
  }

  async function build() {
    if (!plan) return;
    setError(null);
    setPhase('applying');
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/studio/assistant/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        created?: { table: string }[];
        skipped?: string[];
        message?: string;
      };
      if (!res.ok) throw new Error(body.message ?? `build failed (${res.status})`);
      const made = body.created?.length ?? 0;
      const skip = body.skipped?.length ?? 0;
      setDone(
        `✅ built ${made} table${made === 1 ? '' : 's'}` +
          (skip > 0 ? ` · skipped ${skip} that already existed` : ''),
      );
      setPlan(null);
      setPrompt('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'build failed');
    } finally {
      setPhase('idle');
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-md border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)]/30 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="font-mono text-sm text-[var(--color-text)]">✨ ask the assistant</h3>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          describe what you want to keep track of, in your own words — the assistant designs the
          tables, you review them, and build with one click. nothing is created until you say so.
        </p>
      </div>

      <form onSubmit={design} className="flex flex-col gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder={`e.g. "${EXAMPLES[0]}"`}
          className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={phase !== 'idle' || prompt.trim() === ''}
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
          >
            {phase === 'planning' ? 'designing…' : 'design it'}
          </button>
          {phase === 'idle' && !plan
            ? EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPrompt(ex)}
                  className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)]"
                >
                  {ex.toLowerCase()}
                </button>
              ))
            : null}
        </div>
      </form>

      {error ? (
        <p className="rounded-md bg-red-400/10 px-3 py-2 font-mono text-xs text-red-400">{error}</p>
      ) : null}
      {done ? (
        <p className="rounded-md bg-[var(--color-primary-subtle)] px-3 py-2 font-mono text-xs text-[var(--color-primary)]">
          {done}
        </p>
      ) : null}

      {plan ? (
        <div className="flex flex-col gap-3 border-t border-[var(--color-border-subtle)] pt-4">
          {plan.summary ? (
            <p className="font-mono text-xs text-[var(--color-text-muted)]">{plan.summary}</p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {plan.tables.map((t) => (
              <div
                key={t.name}
                className="flex flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3"
              >
                <div>
                  <p className="font-mono text-sm text-[var(--color-text)]">{t.name}</p>
                  {t.description ? (
                    <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">
                      {t.description}
                    </p>
                  ) : null}
                </div>
                <ul className="flex flex-col gap-1">
                  {t.columns.map((col) => (
                    <li
                      key={col.name}
                      className="flex items-center justify-between gap-2 font-mono text-[11px]"
                    >
                      <span className="text-[var(--color-text-muted)]">{col.name}</span>
                      <span className="text-[var(--color-text-subtle)]">
                        {TYPE_LABELS[col.type] ?? col.type}
                        {col.notNull ? ' · required' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                {t.sampleRows.length > 0 ? (
                  <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                    + {t.sampleRows.length} example row{t.sampleRows.length === 1 ? '' : 's'}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={build}
              disabled={phase !== 'idle'}
              className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {phase === 'applying' ? 'building…' : '✅ build it'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlan(null);
                setError(null);
              }}
              disabled={phase !== 'idle'}
              className="rounded-md border border-[var(--color-border)] px-4 py-2 font-mono text-sm text-[var(--color-text-muted)] transition hover:text-[var(--color-text)] disabled:opacity-50"
            >
              start over
            </button>
            <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              tip: save a snapshot first if you want a clean undo point.
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
