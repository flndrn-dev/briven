'use client';

import { useState } from 'react';

import type { SnapshotDiff } from './diff-panel';

/**
 * Restore preview — "no surprises" before an undo. Restore replaces the live
 * data with the snapshot, so before anything is overwritten we show the user,
 * in plain words, exactly what restoring will do to their data. We reuse the
 * same diff the "compare" view uses, but FLIP the framing: the diff describes
 * how the live data drifted FROM the snapshot, so restoring undoes that drift —
 *   - rows added live since   → restore will REMOVE them
 *   - rows removed live since  → restore will BRING THEM BACK
 *   - rows changed live since  → restore will REVERT them
 * Only after the user reads this and clicks the final confirm does the parent
 * <form>'s restore server action actually run. Admin-tier (the page is admin).
 */

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Does restoring this table change anything? (mirrors the live/snapshot diff) */
function tableAffected(t: SnapshotDiff['tables'][number]): boolean {
  if (t.columnsAdded.length > 0 || t.columnsRemoved.length > 0) return true;
  if (!t.rows) return false;
  return t.rows.added > 0 || t.rows.removed > 0 || t.rows.changed > 0;
}

export function RestorePreview({
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

  async function preview() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (diff || loading) return;
    setLoading(true);
    setError(null);
    try {
      setDiff(await loadDiff());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not preview');
    } finally {
      setLoading(false);
    }
  }

  const affectedTables = diff?.tables.filter(tableAffected) ?? [];
  // Tables that exist only live now (added since the snapshot) are NOT touched
  // by restore — it only replaces tables the snapshot captured. We surface that
  // so the user isn't surprised that a newer table survives the restore.
  const untouched = diff?.tablesAdded ?? [];
  // Tables in the snapshot but since dropped live can't be brought back by a
  // data restore — be honest about it.
  const cannotRestore = diff?.tablesRemoved ?? [];
  const nothingToDo =
    diff !== null && affectedTables.length === 0 && cannotRestore.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={preview}
        className="self-start rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-text)]"
      >
        {open ? 'cancel restore' : 'restore'}
      </button>

      {open && (
        <div className="rounded-md border border-[var(--color-warning)] bg-[var(--color-bg)] p-4 font-mono text-xs">
          <p className="text-[var(--color-text-muted)]">
            preview — if you restore &ldquo;{snapshotName}&rdquo;, here&apos;s what will happen
            to your data:
          </p>

          {loading && <p className="mt-2 text-[var(--color-text-subtle)]">checking&hellip;</p>}

          {error && (
            <p className="mt-2 text-[var(--color-error)]">couldn&apos;t preview: {error}</p>
          )}

          {diff && !loading && !error && (
            <div className="mt-3 flex flex-col gap-3">
              {nothingToDo && (
                <p className="text-[var(--color-text)]">
                  nothing will change — your data already matches this snapshot.
                </p>
              )}

              {affectedTables.map((t) => (
                <div
                  key={t.name}
                  className="rounded-md border border-[var(--color-border-subtle)] px-3 py-2"
                >
                  <p className="text-[var(--color-text)]">{t.name}</p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-[var(--color-text-muted)]">
                    {/* live-added rows get removed; snapshot-only rows come back. */}
                    {t.rows && t.rows.removed > 0 && (
                      <li>{plural(t.rows.removed, 'row')} will come back</li>
                    )}
                    {t.rows && t.rows.added > 0 && (
                      <li>{plural(t.rows.added, 'row')} will be removed</li>
                    )}
                    {t.rows && t.rows.changed > 0 && (
                      <li>{plural(t.rows.changed, 'row')} will be reverted to the saved version</li>
                    )}
                    {t.columnsAdded.length > 0 && (
                      <li className="text-[var(--color-text-subtle)]">
                        newer {t.columnsAdded.length === 1 ? 'field' : 'fields'} (
                        {t.columnsAdded.map((c) => c.name).join(', ')}) will be emptied for rows
                        that come back
                      </li>
                    )}
                    {t.columnsRemoved.length > 0 && (
                      <li className="text-[var(--color-text-subtle)]">
                        {t.columnsRemoved.length === 1 ? 'a field that was' : 'fields that were'}{' '}
                        removed since ({t.columnsRemoved.map((c) => c.name).join(', ')}) can&apos;t
                        be brought back by restore
                      </li>
                    )}
                    {t.rows?.truncated && (
                      <li className="text-[var(--color-text-subtle)]">
                        (only the first {diff.rowCap.toLocaleString()} rows were checked — the full
                        table is still restored)
                      </li>
                    )}
                  </ul>
                </div>
              ))}

              {untouched.length > 0 && (
                <p className="text-[var(--color-text-subtle)]">
                  {untouched.length === 1 ? 'this newer table' : 'these newer tables'} won&apos;t be
                  touched: {untouched.join(', ')}
                </p>
              )}

              {cannotRestore.length > 0 && (
                <p className="text-[var(--color-text-subtle)]">
                  {cannotRestore.length === 1 ? 'this table was' : 'these tables were'} deleted
                  since the snapshot and can&apos;t be brought back: {cannotRestore.join(', ')}
                </p>
              )}

              <button
                type="submit"
                onClick={(e) => {
                  if (
                    !window.confirm(
                      'Yes, restore — this will OVERWRITE your current data with the snapshot. This cannot be undone (unless you saved a newer snapshot first).',
                    )
                  ) {
                    e.preventDefault();
                  }
                }}
                className="mt-1 self-start rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
              >
                yes, restore — overwrite current data
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
