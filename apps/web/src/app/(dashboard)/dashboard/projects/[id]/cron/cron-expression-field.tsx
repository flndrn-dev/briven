'use client';

import { useEffect, useState } from 'react';

interface Props {
  projectId: string;
  apiOrigin: string;
  /** Initial value, e.g. "0 4 * * *". */
  defaultValue?: string;
}

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; runs: string[] }
  | { kind: 'error'; message: string };

const DEBOUNCE_MS = 250;

/**
 * Cron expression input with a live "next 5 fire times" preview.
 *
 * The input itself is uncontrolled and posts to the parent form on
 * submit (matching the rest of the page's server-action pattern). The
 * preview state is owned here: every keystroke debounces a POST to the
 * /preview endpoint the api already exposes, which validates the
 * expression and returns the next five fire times in UTC.
 */
export function CronExpressionField({
  projectId,
  apiOrigin,
  defaultValue = '0 4 * * *',
}: Props) {
  const [value, setValue] = useState(defaultValue);
  const [state, setState] = useState<PreviewState>({ kind: 'idle' });

  useEffect(() => {
    if (!value.trim()) {
      setState({ kind: 'idle' });
      return;
    }
    const handle = setTimeout(() => {
      void fetchPreview();
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);

    async function fetchPreview() {
      setState({ kind: 'loading' });
      try {
        const res = await fetch(
          `${apiOrigin}/v1/projects/${projectId}/schedules/preview`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ cronExpression: value }),
          },
        );
        const json = (await res.json()) as
          | { ok: true; nextRuns: string[] }
          | { ok: false; code: string; message: string };
        if ('ok' in json && json.ok) {
          setState({ kind: 'ok', runs: json.nextRuns });
        } else {
          setState({
            kind: 'error',
            message: 'message' in json ? json.message : 'invalid cron expression',
          });
        }
      } catch (err) {
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'preview failed',
        });
      }
    }
  }, [value, projectId, apiOrigin]);

  return (
    <>
      <input
        required
        name="cronExpression"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="0 4 * * *"
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
      />
      <PreviewPanel state={state} />
    </>
  );
}

function PreviewPanel({ state }: { state: PreviewState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'loading') {
    return (
      <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">checking expression…</p>
    );
  }
  if (state.kind === 'error') {
    return (
      <p className="font-mono text-[10px] text-[var(--color-error)]">{state.message}</p>
    );
  }
  return (
    <details
      open
      className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2"
    >
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]">
        next 5 fire times (utc)
      </summary>
      <ul className="mt-2 flex flex-col gap-0.5 font-mono text-[10px] text-[var(--color-text)]">
        {state.runs.map((run, i) => (
          <li key={run} className="flex gap-2">
            <span className="w-4 text-right text-[var(--color-text-subtle)]">{i + 1}.</span>
            <time dateTime={run}>{run.replace('T', ' ').replace('.000Z', ' utc')}</time>
          </li>
        ))}
      </ul>
    </details>
  );
}
