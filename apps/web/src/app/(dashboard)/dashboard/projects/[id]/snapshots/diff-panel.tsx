'use client';

import { useState } from 'react';

/**
 * "What changed since this snapshot" — a friendly, plain-language compare view
 * for non-coders. Calls a server action that fetches the diff from the API,
 * then renders it in everyday words ("3 rows added, 1 changed in Customers")
 * instead of database jargon. Collapsed until the user clicks "compare".
 */

interface ColumnDiff {
  name: string;
  dataType: string;
}

interface TableRowDiff {
  added: number;
  removed: number;
  changed: number;
  liveRowCount: number;
  snapshotRowCount: number;
  truncated: boolean;
}

interface TableDiff {
  name: string;
  columnsAdded: ColumnDiff[];
  columnsRemoved: ColumnDiff[];
  rows: TableRowDiff | null;
  noPrimaryKey: boolean;
}

export interface SnapshotDiff {
  snapshotId: string;
  snapshotName: string;
  snapshotCreatedAt: string;
  tablesAdded: string[];
  tablesRemoved: string[];
  tables: TableDiff[];
  rowCap: number;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** True when this table has nothing different to report. */
function tableUnchanged(t: TableDiff): boolean {
  if (t.columnsAdded.length > 0 || t.columnsRemoved.length > 0) return false;
  if (!t.rows) return false; // can't tell (no primary key) — show it
  return t.rows.added === 0 && t.rows.removed === 0 && t.rows.changed === 0;
}

export function DiffPanel({
  snapshotName,
  loadDiff,
}: {
  snapshotName: string;
  loadDiff: () => Promise<SnapshotDiff>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (diff || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadDiff();
      setDiff(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not compare');
    } finally {
      setLoading(false);
    }
  }

  const changedTables = diff?.tables.filter((t) => !tableUnchanged(t)) ?? [];
  const nothingChanged =
    diff !== null &&
    diff.tablesAdded.length === 0 &&
    diff.tablesRemoved.length === 0 &&
    changedTables.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={toggle}
        className="self-start rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-text)]"
      >
        {open ? 'hide changes' : 'compare'}
      </button>

      {open && (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-4 font-mono text-xs">
          <p className="text-[var(--color-text-muted)]">
            what changed in your data since &ldquo;{snapshotName}&rdquo; was saved:
          </p>

          {loading && (
            <p className="mt-2 text-[var(--color-text-subtle)]">comparing&hellip;</p>
          )}

          {error && (
            <p className="mt-2 text-[var(--color-error)]">
              couldn&apos;t compare: {error}
            </p>
          )}

          {diff && !loading && !error && (
            <div className="mt-3 flex flex-col gap-3">
              {nothingChanged && (
                <p className="text-[var(--color-text)]">
                  nothing has changed — your data is exactly as it was in this snapshot.
                </p>
              )}

              {diff.tablesAdded.length > 0 && (
                <p className="text-[var(--color-text)]">
                  new {diff.tablesAdded.length === 1 ? 'table' : 'tables'} added since:{' '}
                  <span className="text-[var(--color-text-muted)]">
                    {diff.tablesAdded.join(', ')}
                  </span>
                </p>
              )}

              {diff.tablesRemoved.length > 0 && (
                <p className="text-[var(--color-text)]">
                  {diff.tablesRemoved.length === 1 ? 'table' : 'tables'} removed since:{' '}
                  <span className="text-[var(--color-text-muted)]">
                    {diff.tablesRemoved.join(', ')}
                  </span>
                </p>
              )}

              {changedTables.map((t) => (
                <div
                  key={t.name}
                  className="rounded-md border border-[var(--color-border-subtle)] px-3 py-2"
                >
                  <p className="text-[var(--color-text)]">{t.name}</p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-[var(--color-text-muted)]">
                    {t.rows && t.rows.added > 0 && (
                      <li>{plural(t.rows.added, 'row')} added</li>
                    )}
                    {t.rows && t.rows.changed > 0 && (
                      <li>{plural(t.rows.changed, 'row')} changed</li>
                    )}
                    {t.rows && t.rows.removed > 0 && (
                      <li>{plural(t.rows.removed, 'row')} removed</li>
                    )}
                    {t.columnsAdded.length > 0 && (
                      <li>
                        new {t.columnsAdded.length === 1 ? 'field' : 'fields'}:{' '}
                        {t.columnsAdded.map((c) => c.name).join(', ')}
                      </li>
                    )}
                    {t.columnsRemoved.length > 0 && (
                      <li>
                        {t.columnsRemoved.length === 1 ? 'field' : 'fields'} removed:{' '}
                        {t.columnsRemoved.map((c) => c.name).join(', ')}
                      </li>
                    )}
                    {t.noPrimaryKey && (
                      <li className="text-[var(--color-text-subtle)]">
                        can&apos;t compare rows in this table (it has no unique id column)
                      </li>
                    )}
                    {t.rows?.truncated && (
                      <li className="text-[var(--color-text-subtle)]">
                        (only the first {diff.rowCap.toLocaleString()} rows were compared)
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
