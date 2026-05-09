'use client';

import { useState, useTransition } from 'react';

type Result =
  | { ok: true; value: unknown; durationMs: number; deploymentId: string }
  | {
      ok: false;
      code: string;
      message: string;
      durationMs: number;
      deploymentId?: string;
    };

interface Props {
  projectId: string;
  functionName: string;
}

export function InvokePanel({ projectId, functionName }: Props) {
  const [args, setArgs] = useState('{}');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    let parsed: unknown = null;
    try {
      if (args.trim().length > 0) parsed = JSON.parse(args);
    } catch {
      setError('args must be valid json');
      return;
    }

    startTransition(async () => {
      const res = await fetch(`/api/v1/projects/${projectId}/functions/${functionName}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(parsed),
      });
      const body = (await res.json()) as Result | { code: string; message: string };
      if ('ok' in body) {
        setResult(body);
      } else {
        setResult({ ok: false, code: body.code, message: body.message, durationMs: 0 });
      }
    });
  }

  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-sm text-[var(--color-text)]">{functionName}</p>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'invoking...' : 'invoke'}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">args (json)</span>
          <textarea
            value={args}
            onChange={(e) => setArgs(e.currentTarget.value)}
            spellCheck={false}
            rows={8}
            className="resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
          {error ? (
            <p role="alert" className="font-mono text-xs text-red-400">
              {error}
            </p>
          ) : null}
        </label>

        <div className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            result
            {result ? (
              <span className="ml-2 text-[var(--color-text-subtle)]">
                {result.durationMs}ms ·{' '}
                <span className={result.ok ? 'text-[var(--color-primary)]' : 'text-red-400'}>
                  {result.ok ? 'ok' : result.code}
                </span>
              </span>
            ) : null}
          </span>
          <pre className="h-full min-h-[12rem] overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-xs text-[var(--color-text)]">
            {result ? JSON.stringify(result.ok ? result.value : result.message, null, 2) : '—'}
          </pre>
        </div>
      </div>
    </div>
  );
}
