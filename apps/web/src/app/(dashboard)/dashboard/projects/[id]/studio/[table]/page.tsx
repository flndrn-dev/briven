import Link from 'next/link';
import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../../../lib/api';
import { DeleteRowButton } from './delete-row-button';
import { EditableCell } from './editable-cell';
import { FilterBar } from './filter-bar';
import { AutoRefresh } from './auto-refresh';
import { InsertRowForm } from './insert-row-form';
import { SchemaPanel } from './schema-panel';

interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultExpr: string | null;
  ordinalPosition: number;
  isPrimaryKey: boolean;
  references?: { table: string; column: string } | null;
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

  // Re-export every `<col>__<op>=value` query param onto the API call so
  // filters survive pagination + the next-page link below. The API rejects
  // unknown ops; the route only matches known suffixes from FILTER_OPS.
  const FILTER_OP_SUFFIXES = ['__eq', '__contains', '__gt', '__lt', '__gte', '__lte'];
  const filterPairs: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(sp)) {
    if (!FILTER_OP_SUFFIXES.some((s) => k.endsWith(s))) continue;
    const value = asString(v);
    if (value !== undefined && value !== '') filterPairs.push([k, value]);
  }

  const queryString = new URLSearchParams([
    ['limit', String(PAGE_SIZE)],
    ['offset', String(offset)],
    ...(orderBy ? ([['orderBy', orderBy], ['dir', dir]] as Array<[string, string]>) : []),
    ...filterPairs,
  ]).toString();

  const [data, indexesResult, tablesResult] = await Promise.all([
    apiJson<TableRows>(
      `/v1/projects/${id}/studio/tables/${encodeURIComponent(table)}/rows?${queryString}`,
    ),
    apiJson<{
      indexes: Array<{ name: string; columns: string[]; unique: boolean; isPrimary: boolean }>;
    }>(`/v1/projects/${id}/studio/tables/${encodeURIComponent(table)}/indexes`).catch(() => ({
      indexes: [] as Array<{
        name: string;
        columns: string[];
        unique: boolean;
        isPrimary: boolean;
      }>,
    })),
    apiJson<{ tables: Array<{ name: string }> }>(`/v1/projects/${id}/studio/tables`).catch(() => ({
      tables: [] as Array<{ name: string }>,
    })),
  ]);
  const otherTables = tablesResult.tables.map((t) => t.name).filter((n) => n !== table);

  const prevOffset = Math.max(0, offset - PAGE_SIZE);
  const nextOffset = offset + PAGE_SIZE;

  // Real primary-key detection — sourced from pg_index.indisprimary on
  // the api side. Composite keys produce multiple PK columns; we send
  // every column's value as part of the row-identity payload. Tables
  // with no PK route to read-only mode (flagged in the banner below).
  const pkColumns = data.columns.filter((c) => c.isPrimaryKey);
  const pkColumnNames = pkColumns.map((c) => c.name);
  const tableHasPk = pkColumns.length > 0;
  const hasCompositePk = pkColumns.length > 1;

  async function updateRow(input: {
    primaryKey: Array<{ column: string; value: string | number }>;
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
    primaryKey: Array<{ column: string; value: string | number }>;
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
                · composite pk ({pkColumnNames.join(', ')})
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AutoRefresh />
          <InsertRowForm columns={data.columns} action={insertRowAction} />
        </div>
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
                      {col.isPrimaryKey ? (
                        <span
                          className="rounded-sm bg-[var(--color-primary)]/10 px-1 text-[9px] uppercase tracking-wider text-[var(--color-primary)]"
                          title="primary key"
                        >
                          pk
                        </span>
                      ) : null}
                      <span className="text-[var(--color-primary)]">{sortGlyph(col.name)}</span>
                    </span>
                    <span className="text-[10px] text-[var(--color-text-subtle)]">
                      {col.dataType}
                      {col.nullable ? ' · nullable' : ' · not null'}
                      {col.references
                        ? ` · → ${col.references.table}.${col.references.column}`
                        : ''}
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
                // Build the row-identity payload from EVERY PK column.
                // For single-PK tables this is length-1; for composite,
                // length-N. The api validates the column set against the
                // table's actual pg_index.indisprimary on every request.
                const pkPairs: Array<{ column: string; value: string | number }> = [];
                let pkUsable = tableHasPk;
                for (const name of pkColumnNames) {
                  const v = row[name];
                  if (typeof v !== 'string' && typeof v !== 'number') {
                    pkUsable = false;
                    break;
                  }
                  pkPairs.push({ column: name, value: v });
                }
                // Allow inline edits only when every PK value resolves to
                // string|number. A null or bytea PK value (rare but
                // possible) would break the round-trip — read-only fall
                // back is safer than half-working edit.
                const canEdit = pkUsable && pkPairs.length > 0;
                return (
                  <tr
                    key={i}
                    className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface)]"
                  >
                    {data.columns.map((col) => {
                      const isPk = col.isPrimaryKey;
                      const cellValue = row[col.name];
                      const fkLink =
                        col.references && cellValue != null
                          ? `/dashboard/projects/${id}/studio/${encodeURIComponent(
                              col.references.table,
                            )}?${col.references.column}__eq=${encodeURIComponent(String(cellValue))}`
                          : null;
                      return (
                        <td key={col.name} className="max-w-xs truncate px-3 py-2 align-top">
                          <div className="flex items-center gap-1">
                            <div className="min-w-0 flex-1 truncate">
                              {canEdit ? (
                                <EditableCell
                                  action={updateRow}
                                  primaryKey={pkPairs}
                                  column={col.name}
                                  initialValue={cellValue}
                                  readOnly={isPk}
                                />
                              ) : (
                                renderCell(cellValue)
                              )}
                            </div>
                            {fkLink ? (
                              <Link
                                href={fkLink}
                                className="shrink-0 text-[var(--color-text-subtle)] hover:text-[var(--color-primary)]"
                                title={`open ${col.references!.table}.${col.references!.column} = ${String(cellValue)}`}
                              >
                                ↗
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 align-top">
                      {canEdit ? (
                        <DeleteRowButton action={deleteRowAction} primaryKey={pkPairs} />
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

      <SchemaPanel
        projectId={id}
        table={table}
        columns={data.columns}
        indexes={indexesResult.indexes}
        otherTables={otherTables}
      />
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
