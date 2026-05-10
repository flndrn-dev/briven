'use client';

import { useState } from 'react';

interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultExpr: string | null;
}

interface Props {
  columns: ColumnInfo[];
  action: (input: { values: Record<string, unknown> }) => Promise<void>;
}

/**
 * Inline insert form, toggled by the "+ new row" button. One input per
 * column. Empty inputs become `null` if the column is nullable, or are
 * skipped (so DB defaults apply) when the column has a `defaultExpr`.
 *
 * Type coercion is minimal: integer / bigint columns parse as numbers,
 * boolean columns parse from "true"/"false", everything else passes
 * through as a string. The server still validates against the actual
 * column type — bad values surface as a server error string.
 */
export function InsertRowForm({ columns, action }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  function reset(): void {
    setDraft({});
    setError(null);
  }

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const values = buildInsertPayload(draft, columns);
      await action({ values });
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'insert failed');
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          reset();
        }}
        className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
      >
        + new row
      </button>
    );
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-xs text-[var(--color-text)]">new row</p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          cancel
        </button>
      </div>
      <div className="grid grid-cols-[160px_1fr] gap-2 font-mono text-xs">
        {columns.map((col) => (
          <label key={col.name} className="contents">
            <span className="self-center text-[var(--color-text-muted)]">
              {col.name}
              <span className="ml-1 text-[10px] text-[var(--color-text-subtle)]">
                {col.dataType}
                {col.nullable ? '' : ' · not null'}
                {col.defaultExpr ? ' · has default' : ''}
              </span>
            </span>
            <input
              type="text"
              value={draft[col.name] ?? ''}
              onChange={(e) => setDraft({ ...draft, [col.name]: e.target.value })}
              placeholder={col.defaultExpr ?? (col.nullable ? '(null)' : '')}
              className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 outline-none focus:border-[var(--color-primary)]"
            />
          </label>
        ))}
      </div>
      {error ? (
        <p className="mt-3 font-mono text-xs text-[var(--color-text-error)]">{error}</p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
        >
          {pending ? 'inserting…' : 'insert'}
        </button>
      </div>
    </div>
  );
}

/**
 * Empty input + has-default → omit so the DB default fires.
 * Empty input + nullable → null.
 * Empty input + not-null + no default → omit (server will reject — that's
 * the right behaviour, surfaces the constraint).
 * Otherwise → coerce by data type.
 */
function buildInsertPayload(
  draft: Record<string, string>,
  columns: ColumnInfo[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    const raw = draft[col.name];
    if (raw === undefined || raw === '') {
      if (col.nullable) {
        out[col.name] = null;
      }
      // has-default and not-null+no-default both fall through (omitted).
      continue;
    }
    out[col.name] = coerce(raw, col.dataType);
  }
  return out;
}

function coerce(raw: string, dataType: string): unknown {
  const t = dataType.toLowerCase();
  if (t === 'integer' || t === 'bigint' || t === 'smallint' || t === 'real' || t === 'double precision') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (t === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
  }
  if (t === 'jsonb' || t === 'json') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}
