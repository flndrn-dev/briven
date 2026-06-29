'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface ColumnMeta {
  name: string;
  dataType: string;
}

interface ImportResult {
  inserted: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

interface Props {
  columns: ColumnMeta[];
  tableName: string;
  exportAction: () => Promise<{
    columns: Array<{ name: string }>;
    rows: Record<string, unknown>[];
    truncated: boolean;
  }>;
  importAction: (rows: Record<string, unknown>[]) => Promise<ImportResult>;
}

/**
 * Export / import controls for a table's data view.
 *
 *  - Export: pulls the whole table via the server action (server caps at
 *    100k rows), formats client-side to CSV or JSON, and triggers a browser
 *    download. Reuses the same CSV escaping as the SQL editor.
 *  - Import: reads a .csv or .json file, parses it, coerces cell values by
 *    the column's data type (CSV is all-strings; JSON keeps its types), and
 *    posts the rows. Unknown columns are dropped client-side so a stray
 *    header doesn't fail every row; the server skips bad rows and reports
 *    them, which we surface here. router.refresh() reloads the table after.
 */
export function TableIo({ columns, tableName, exportAction, importAction }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<null | 'export' | 'import'>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(ImportResult & { ignoredColumns: string[] }) | null>(null);

  const colByName = new Map(columns.map((c) => [c.name, c]));
  const ts = () => new Date().toISOString().replace(/[:.]/g, '-');

  async function doExport(format: 'csv' | 'json'): Promise<void> {
    setMenuOpen(false);
    setBusy('export');
    setError(null);
    try {
      const data = await exportAction();
      const cols = data.columns.map((c) => c.name);
      if (format === 'json') {
        triggerDownload(
          new Blob([JSON.stringify(data.rows, null, 2)], { type: 'application/json' }),
          `${tableName}-${ts()}.json`,
        );
      } else {
        const head = cols.map(escapeCsv).join(',');
        const lines = data.rows.map((row) =>
          cols.map((c) => escapeCsv(stringifyForCsv(row[c]))).join(','),
        );
        triggerDownload(
          new Blob([[head, ...lines].join('\n')], { type: 'text/csv' }),
          `${tableName}-${ts()}.csv`,
        );
      }
      if (data.truncated) {
        setError(`exported the first ${data.rows.length} rows (table is larger — export was capped)`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'export failed');
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File): Promise<void> {
    setBusy('import');
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const isJson = file.name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('[');
      const parsed = isJson ? parseJsonRows(text) : parseCsvRows(text);
      // Keep only recognised columns, coerce CSV strings by data type.
      const ignored = new Set<string>();
      const rows = parsed.map((raw) => {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(raw)) {
          const col = colByName.get(key);
          if (!col) {
            ignored.add(key);
            continue;
          }
          if (value === '' || value === undefined) continue; // omit → DB default / null
          out[key] = isJson ? value : coerce(String(value), col.dataType);
        }
        return out;
      });
      if (rows.length === 0) {
        throw new Error('no rows found in file');
      }
      const res = await importAction(rows);
      setResult({ ...res, ignoredColumns: [...ignored] });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'import failed');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="relative flex items-center gap-2">
      {/* Export menu */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={busy !== null}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)] disabled:opacity-60"
        >
          {busy === 'export' ? 'exporting…' : 'export ▾'}
        </button>
        {menuOpen ? (
          <div className="absolute right-0 z-10 mt-1 flex flex-col rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-md">
            <button
              type="button"
              onClick={() => doExport('csv')}
              className="px-4 py-1.5 text-left font-mono text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text)]"
            >
              download csv
            </button>
            <button
              type="button"
              onClick={() => doExport('json')}
              className="px-4 py-1.5 text-left font-mono text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text)]"
            >
              download json
            </button>
          </div>
        ) : null}
      </div>

      {/* Import */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy !== null}
        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)] disabled:opacity-60"
      >
        {busy === 'import' ? 'importing…' : 'import'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />

      {/* Feedback — absolutely positioned so it doesn't push the toolbar */}
      {(error || result) && (
        <div className="absolute right-0 top-full z-10 mt-2 w-80 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs shadow-md">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[var(--color-text-muted)]">
              {result ? 'import result' : 'notice'}
            </span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setResult(null);
              }}
              className="text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"
            >
              dismiss
            </button>
          </div>
          {result ? (
            <div className="flex flex-col gap-1">
              <p className="text-[var(--color-text)]">
                inserted {result.inserted} · failed {result.failed}
              </p>
              {result.ignoredColumns.length > 0 ? (
                <p className="text-[var(--color-text-subtle)]">
                  ignored unknown columns: {result.ignoredColumns.join(', ')}
                </p>
              ) : null}
              {result.errors.length > 0 ? (
                <ul className="mt-1 flex max-h-32 flex-col gap-0.5 overflow-y-auto text-[var(--color-text-error)]">
                  {result.errors.slice(0, 10).map((e) => (
                    <li key={e.row}>
                      row {e.row + 1}: {e.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-[var(--color-text-error)]">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** RFC-4180-ish CSV parser: handles quoted fields, commas + newlines inside
 *  quotes, and doubled "" escapes. Returns an array of row objects keyed by
 *  the header row. */
function parseCsvRows(text: string): Array<Record<string, string>> {
  const records = parseCsv(text);
  const [header, ...dataRows] = records;
  if (!header) return [];
  const out: Array<Record<string, string>> = [];
  for (const cells of dataRows) {
    // Skip fully-empty trailing lines.
    if (cells.length === 1 && cells[0] === '') continue;
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = cells[idx] ?? '';
    });
    out.push(obj);
  }
  return out;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      // Treat \r\n as one break; swallow the paired char.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  // Flush the final field/row if the file didn't end in a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseJsonRows(text: string): Array<Record<string, unknown>> {
  const data = JSON.parse(text) as unknown;
  const arr = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { rows?: unknown }).rows)
      ? (data as { rows: unknown[] }).rows
      : null;
  if (!arr) throw new Error('json must be an array of row objects (or { rows: [...] })');
  return arr.map((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      throw new Error('each json row must be an object');
    }
    return r as Record<string, unknown>;
  });
}

function coerce(raw: string, dataType: string): unknown {
  const t = dataType.toLowerCase();
  if (
    t === 'integer' ||
    t === 'bigint' ||
    t === 'smallint' ||
    t === 'real' ||
    t === 'double precision' ||
    t === 'numeric'
  ) {
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

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function stringifyForCsv(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

function escapeCsv(s: string): string {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
