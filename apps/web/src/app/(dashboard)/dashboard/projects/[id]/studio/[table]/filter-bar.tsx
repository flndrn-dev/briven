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
 * Compact filter bar — pick a column, type a value, submit. Builds a
 * `<col>__eq=<value>` query param that the server route validates +
 * parameterises on the data-plane side. Empty value clears the filter.
 *
 * Stays narrow on purpose. Multi-clause filters and operators other than
 * equality are a future slice.
 */
export function FilterBar({ columns, basePath }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [col, setCol] = useState(columns[0]?.name ?? '');
  const [value, setValue] = useState('');

  // Existing filter chips, gathered from the URL.
  const activeFilters: Array<{ col: string; value: string }> = [];
  for (const [k, v] of searchParams.entries()) {
    if (k.endsWith('__eq')) {
      activeFilters.push({ col: k.slice(0, -'__eq'.length), value: v });
    }
  }

  function apply(): void {
    const next = new URLSearchParams(searchParams.toString());
    next.set(`${col}__eq`, value);
    next.delete('offset'); // jump back to page 1 on filter change
    router.push(`${basePath}?${next.toString()}`);
  }

  function clear(target: string): void {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(`${target}__eq`);
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
        <span className="text-[var(--color-text-subtle)]">=</span>
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
              key={f.col}
              type="button"
              onClick={() => clear(f.col)}
              className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[var(--color-text-muted)] hover:border-[var(--color-text-error)] hover:text-[var(--color-text-error)]"
              title="click to clear"
            >
              {f.col} = {f.value} ×
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
