'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

interface ColumnInfo {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
}

interface Props {
  columns: ColumnInfo[];
  /** Path the new query string is applied to (no params). */
  basePath: string;
}

/**
 * Compact filter bar — pick a column + operator + value, submit. Builds a
 * `<col>__<op>=<value>` query param that the server route validates against
 * the FILTER_OPS allow-list and parameterises on the data-plane side.
 */
const FILTER_OPS = ['eq', 'contains', 'gt', 'lt', 'gte', 'lte'] as const;
type FilterOp = (typeof FILTER_OPS)[number];

const OP_LABEL: Record<FilterOp, string> = {
  eq: '=',
  contains: 'contains',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
};

export function FilterBar({ columns, basePath }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [col, setCol] = useState(columns[0]?.name ?? '');
  const [op, setOp] = useState<FilterOp>('eq');
  const [value, setValue] = useState('');

  // Existing filter chips, gathered from the URL.
  const activeFilters: Array<{ col: string; op: FilterOp; value: string }> = [];
  for (const [k, v] of searchParams.entries()) {
    const sepAt = k.lastIndexOf('__');
    if (sepAt <= 0) continue;
    const opCandidate = k.slice(sepAt + 2) as FilterOp;
    if (!(FILTER_OPS as readonly string[]).includes(opCandidate)) continue;
    activeFilters.push({ col: k.slice(0, sepAt), op: opCandidate, value: v });
  }

  function apply(): void {
    const next = new URLSearchParams(searchParams.toString());
    next.set(`${col}__${op}`, value);
    next.delete('offset'); // jump back to page 1 on filter change
    router.push(`${basePath}?${next.toString()}`);
  }

  function clear(targetCol: string, targetOp: FilterOp): void {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(`${targetCol}__${targetOp}`);
    next.delete('offset');
    router.push(`${basePath}?${next.toString()}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">filter:</span>
        <select
          value={col}
          onChange={(e) => setCol(e.target.value)}
          className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1"
        >
          {columns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={op}
          onChange={(e) => setOp(e.target.value as FilterOp)}
          className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1"
          aria-label="operator"
        >
          {FILTER_OPS.map((o) => (
            <option key={o} value={o}>
              {OP_LABEL[o]}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply();
          }}
          placeholder="value"
          className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 outline-none focus:border-[var(--color-primary)]"
        />
        <button
          type="button"
          onClick={apply}
          disabled={!col || value === ''}
          className="rounded-sm border border-[var(--color-border)] px-2 py-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
        >
          apply
        </button>
      </div>
      {activeFilters.length > 0 ? (
        <div className="flex flex-wrap gap-2 font-mono text-[10px]">
          {activeFilters.map((f) => (
            <button
              key={`${f.col}__${f.op}`}
              type="button"
              onClick={() => clear(f.col, f.op)}
              className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[var(--color-text-muted)] hover:border-[var(--color-text-error)] hover:text-[var(--color-text-error)]"
              title="click to clear"
            >
              {f.col} {OP_LABEL[f.op]} {f.value} ×
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
