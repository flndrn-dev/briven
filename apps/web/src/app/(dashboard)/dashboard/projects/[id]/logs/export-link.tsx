'use client';

import { useState } from 'react';

interface FunctionLog {
  id: string;
  invocationId: string;
  functionName: string;
  status: 'ok' | 'err';
  durationMs: string;
  touchedTables: unknown;
  userLogsJson: unknown;
  errCode: string | null;
  errMessage: string | null;
  createdAt: string;
}

interface Props {
  projectId: string;
  /** Query string the page is currently displaying (e.g. ?function=foo&status=err). */
  query: string;
}

/**
 * Walks the function-logs cursor pagination to fetch up to MAX_ROWS matching
 * the current filters, then downloads as JSON. Caps at 1000 to keep the
 * browser responsive — anything bigger should use the SQL editor.
 */
const MAX_ROWS = 1000;
const PAGE_SIZE = 200;

export function ExportLogsLink({ projectId, query }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [count, setCount] = useState(0);

  async function onClick() {
    setState('loading');
    setCount(0);
    try {
      const all: FunctionLog[] = [];
      let before: string | null = null;
      while (all.length < MAX_ROWS) {
        const params = new URLSearchParams(query.replace(/^\?/, ''));
        params.set('limit', String(PAGE_SIZE));
        if (before) params.set('before', before);
        const res = await fetch(
          `/api/v1/projects/${projectId}/function-logs?${params.toString()}`,
        );
        if (!res.ok) {
          throw new Error(`http ${res.status}`);
        }
        const { logs } = (await res.json()) as { logs: FunctionLog[] };
        if (logs.length === 0) break;
        all.push(...logs);
        setCount(all.length);
        if (logs.length < PAGE_SIZE) break;
        const last = logs[logs.length - 1];
        if (!last) break;
        before = last.createdAt;
      }
      const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `function-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setState('done');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === 'loading'}
      className="rounded-md border border-[var(--color-border)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
    >
      {state === 'loading'
        ? `fetching… ${count}`
        : state === 'done'
          ? 'downloaded'
          : state === 'error'
            ? 'failed'
            : 'export json'}
    </button>
  );
}
