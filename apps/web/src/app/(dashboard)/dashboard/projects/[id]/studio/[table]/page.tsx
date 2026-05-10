import Link from 'next/link';
import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../../../lib/api';
import { DeleteRowButton } from './delete-row-button';
import { EditableCell } from './editable-cell';
import { FilterBar } from './filter-bar';
import { InsertRowForm } from './insert-row-form';

interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultExpr: string | null;
  ordinalPosition: number;
  isPrimaryKey: boolean;
}

interface TableRows {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export const metadata = { title: 'studio · table' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function TablePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; table: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, table } = await params;
  const sp = await searchParams;
  const offset = Math.max(0, Number(asString(sp.offset) ?? '0') || 0);
  const orderBy = asString(sp.orderBy);
  const dir: 'asc' | 'desc' = asString(sp.dir) === 'desc' ? 'desc' : 'asc';

  // Re-export every `<col>__eq=value` query param onto the API call so
  // filters survive pagination + the next-page link below.
  const filterPairs: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(sp)) {
    if (k.endsWith('__eq')) {
      const value = asString(v);
      if (value !== undefined && value !== '') filterPairs.push([k, value]);
    }
  }

  const queryString = new URLSearchParams([
    ['limit', String(PAGE_SIZE)],
    ['offset', String(offset)],
    ...(orderBy ? ([['orderBy', orderBy], ['dir', dir]] as Array<[string, string]>) : []),
    ...filterPairs,
  ]).toString();

  const data = await apiJson<TableRows>(
    `/v1/projects/${id}/studio/tables/${encodeURIComponent(table)}/rows?${queryString}`,
  );

  const prevOffset = Math.max(0, offset - PAGE_SIZE);
  const nextOffset = offset + PAGE_SIZE;

  // Real primary-key detection — sourced from pg_index.indisprimary on
  // the api side. Falls back to the first column only when the table
  // genuinely has no PK (rare; flagged in the UI below). For composite
  // PKs we pick the first PK column — composite-key edits land in a
  // future slice when there's a UI affordance for multi-column row
  // identity.
  const pkColumns = data.columns.filter((c) => c.isPrimaryKey);
  const pkColumn = pkColumns[0]?.name ?? data.columns[0]?.name ?? null;
  const tableHasPk = pkColumns.length > 0;
  const hasCompositePk = pkColumns.length > 1;

  async function updateRow(input: {
    primaryKeyColumn: string;
    primaryKeyValue: string | number;
    column: string;
    value: unknown;
  }): Promise<void> {
    'use server';
    const res = await apiFetch(
      `/v1/projects/${id}/studio/tables/${encodeURIComponent(table)}/rows`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `update failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/studio/${table}`);
  }

  async function deleteRowAction(input: {
    primaryKeyColumn: string;
    primaryKeyValue: string | number;
  }): Promise<void> {
    'use server';
    const res = await apiFetch(
      `/v1/projects/${id}/studio/tables/${encodeURIComponent(table)}/rows`,
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `delete failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/studio/${table}`);
  }

  async function insertRowAction(input: { values: Record<string, unknown> }): Promise<void> {
    'use server';
    const res = await apiFetch(
      `/v1/projects/${id}/studio/tables/${encodeURIComponent(table)}/rows`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `insert failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/studio/${table}`);
  }

  // Build a per-page link helper that preserves sort + filters but
  // overrides the named keys (used by the prev/next nav and the
  // sortable column headers).
  function withParams(overrides: Record<string, string | null>): string {
    const next = new URLSearchParams();
    if (orderBy) {
      next.set('orderBy', orderBy);
      next.set('dir', dir);
    }
    for (const [k, v] of filterPairs) next.set(k, v);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `/dashboard/projects/${id}/studio/${encodeURIComponent(table)}?${next.toString()}`;
  }

  function sortHrefFor(colName: string): string {
    if (orderBy === colName && dir === 'asc') {
      return withParams({ orderBy: colName, dir: 'desc', offset: '0' });
    }
    if (orderBy === colName && dir === 'desc') {
      return withParams({ orderBy: null, dir: null, offset: '0' });
    }
    return withParams({ orderBy: colName, dir: 'asc', offset: '0' });
  }

  function sortGlyph(colName: string): string {
    if (orderBy !== colName) return '';
    return dir === 'asc' ? '↑' : '↓';
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <Link
            href={`/dashboard/projects/${id}/studio`}
            className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            ← all tables
          </Link>
          <h2 className="mt-1 font-mono text-lg tracking-tight">{table}</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            {data.columns.length} column{data.columns.length === 1 ? '' : 's'} · showing rows{' '}
            {offset + 1}–{offset + data.rows.length}
            {data.hasMore ? ' (more)' : ''}
            {!tableHasPk ? (
              <span className="ml-2 text-[var(--color-text-error)]">
                · no primary key — row edit + delete disabled
              </span>
            ) : null}
            {hasCompositePk ? (
              <span className="ml-2 text-[var(--color-text-subtle)]">
                · composite pk; edits use {pkColumn} only
              </span>
            ) : null}
          </p>
        </div>
        <InsertRowForm columns={data.columns} action={insertRowAction} />
      </header>

      <FilterBar
        columns={data.columns}
        basePath={`/dashboard/projects/${id}/studio/${encodeURIComponent(table)}`}
      />

      <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
        <table className="w-full min-w-max font-mono text-xs">
          <thead className="bg-[var(--color-surface)]">
            <tr className="text-left text-[var(--color-text-muted)]">
              {data.columns.map((col) => (
                <th key={col.name} className="px-3 py-2 font-normal">
                  <Link
                    href={sortHrefFor(col.name)}
                    className="flex flex-col hover:text-[var(--color-primary)]"
                  >
                    <span className="flex items-center gap-1 text-[var(--color-text)]">
                      {col.name}
                      <span className="text-[var(--color-primary)]">{sortGlyph(col.name)}</span>
                    </span>
                    <span className="text-[10px] text-[var(--color-text-subtle)]">
                      {col.dataType}
                      {col.nullable ? '' : ' · not null'}
                    </span>
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={data.columns.length}
                  className="px-3 py-6 text-center font-mono text-xs text-[var(--color-text-muted)]"
                >
                  no rows in this page.
                </td>
              </tr>
            ) : (
              data.rows.map((row, i) => {
                const pkValue = pkColumn ? row[pkColumn] : null;
                // Allow edits only when the table has a real primary key —
                // surrogate-PK-by-first-column would silently UPDATE the
                // wrong row when two rows share the same first-column
                // value. Better to disable editing on PK-less tables and
                // surface the constraint in the header banner above.
                const canEdit =
                  tableHasPk
                  && pkColumn !== null
                  && (typeof pkValue === 'string' || typeof pkValue === 'number');
                return (
                  <tr
                    key={i}
                    className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface)]"
                  >
                    {data.columns.map((col) => {
                      const isPk = col.isPrimaryKey;
                      return (
                        <td key={col.name} className="max-w-xs truncate px-3 py-2 align-top">
                          {canEdit ? (
                            <EditableCell
                              action={updateRow}
                              primaryKeyColumn={pkColumn}
                              primaryKeyValue={pkValue as string | number}
                              column={col.name}
                              initialValue={row[col.name]}
                              readOnly={isPk}
                            />
                          ) : (
                            renderCell(row[col.name])
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 align-top">
                      {canEdit ? (
                        <DeleteRowButton
                          action={deleteRowAction}
                          primaryKeyColumn={pkColumn}
                          primaryKeyValue={pkValue as string | number}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <nav className="flex items-center justify-between font-mono text-xs">
        <Link
          href={withParams({ offset: String(prevOffset) })}
          aria-disabled={offset === 0}
          className={`rounded-md border border-[var(--color-border)] px-3 py-1 ${
            offset === 0
              ? 'pointer-events-none text-[var(--color-text-subtle)] opacity-50'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          ← prev
        </Link>
        <span className="text-[var(--color-text-subtle)]">
          offset {offset.toLocaleString()}
        </span>
        <Link
          href={withParams({ offset: String(nextOffset) })}
          aria-disabled={!data.hasMore}
          className={`rounded-md border border-[var(--color-border)] px-3 py-1 ${
            !data.hasMore
              ? 'pointer-events-none text-[var(--color-text-subtle)] opacity-50'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          next →
        </Link>
      </nav>
    </section>
  );
}

/** Coerce a Next.js searchParams entry (string | string[] | undefined) to a single string. */
function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Render a cell value tersely. Postgres returns JS Date for timestamptz,
 * Buffer for bytea, etc. — strings, numbers, booleans pass through; nulls
 * show explicitly so a user can distinguish from empty string; objects
 * (jsonb, arrays) get JSON.stringify with truncation.
 */
function renderCell(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-[var(--color-text-subtle)]">null</span>;
  }
  if (value instanceof Date) {
    return <span>{value.toISOString()}</span>;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span>{String(value)}</span>;
  }
  const s = JSON.stringify(value);
  return <span title={s}>{s.length > 80 ? `${s.slice(0, 80)}…` : s}</span>;
}
