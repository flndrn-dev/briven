'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';

interface QueryResult {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  command: string;
  elapsedMs: number;
}

const STARTER_SQL = `-- examples
-- SELECT * FROM your_table LIMIT 10;
-- SELECT count(*) FROM your_table;
-- UPDATE your_table SET col = 'value' WHERE id = '…';

`;

const HISTORY_MAX = 10;

function historyKey(projectId: string): string {
  return `briven.sql.history.${projectId}`;
}

function loadHistory(projectId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(historyKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveHistory(projectId: string, history: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(historyKey(projectId), JSON.stringify(history));
  } catch {
    // storage quota — drop silently
  }
}

export function SqlEditor({ projectId }: { projectId: string }) {
  const [sql, setSql] = useState(STARTER_SQL);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    setHistory(loadHistory(projectId));
  }, [projectId]);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/studio/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      const data = (await res.json()) as QueryResult;
      setResult(data);
      // Push the successfully-run sql onto the history. De-dupe consecutive
      // duplicates so users hitting "run" 5x doesn't fill the slate.
      setHistory((prev) => {
        const trimmed = sql.trim();
        if (!trimmed || prev[0] === trimmed) return prev;
        const next = [trimmed, ...prev.filter((q) => q !== trimmed)].slice(0, HISTORY_MAX);
        saveHistory(projectId, next);
        return next;
      });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'query failed');
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        rows={10}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-xs outline-none focus:border-[var(--color-primary)]"
      />
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          press <kbd className="rounded bg-[var(--color-surface)] px-1">⌘</kbd>+
          <kbd className="rounded bg-[var(--color-surface)] px-1">↵</kbd> to run
        </p>
        <button
          type="button"
          onClick={run}
          disabled={pending || sql.trim() === ''}
          className="rounded-md bg-[var(--color-primary)] px-4 py-1.5 font-mono text-xs font-medium text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'running…' : 'run query'}
        </button>
      </div>

      {history.length > 0 ? (
        <details className="rounded-md border border-[var(--color-border-subtle)]">
          <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] text-[var(--color-text-muted)]">
            history ({history.length})
          </summary>
          <ul className="flex flex-col gap-1 border-t border-[var(--color-border-subtle)] p-2">
            {history.map((q, i) => (
              <li key={i} className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => setSql(q)}
                  className="flex-1 truncate rounded-md bg-[var(--color-surface)] px-2 py-1 text-left font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  title={q}
                >
                  {q.replace(/\s+/g, ' ').slice(0, 100)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHistory((prev) => {
                      const next = prev.filter((x) => x !== q);
                      saveHistory(projectId, next);
                      return next;
                    });
                  }}
                  className="font-mono text-[10px] text-[var(--color-text-subtle)] hover:text-[var(--color-text-error)]"
                  aria-label="forget this query"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {error ? (
        <pre className="overflow-x-auto rounded-md bg-red-400/10 p-3 font-mono text-xs text-red-400">
          {error}
        </pre>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between font-mono text-[10px] text-[var(--color-text-muted)]">
            <span>
              {result.command} · {result.rowCount} row{result.rowCount === 1 ? '' : 's'}
            </span>
            <span>{result.elapsedMs.toLocaleString()}ms</span>
          </div>
          {result.rows.length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--color-border)] p-4 text-center font-mono text-xs text-[var(--color-text-muted)]">
              statement executed — no rows returned.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
              <table className="w-full min-w-max font-mono text-xs">
                <thead className="bg-[var(--color-surface)]">
                  <tr className="text-left text-[var(--color-text-muted)]">
                    {result.columns.map((c) => (
                      <th key={c.name} className="px-3 py-2 font-normal">
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 200).map((row, i) => (
                    <tr
                      key={i}
                      className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface)]"
                    >
                      {result.columns.map((c) => (
                        <td key={c.name} className="max-w-xs truncate px-3 py-2 align-top">
                          {renderValue(row[c.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > 200 ? (
                <p className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 font-mono text-[10px] text-[var(--color-text-subtle)]">
                  showing first 200 of {result.rows.length}. add a LIMIT to your query.
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}
