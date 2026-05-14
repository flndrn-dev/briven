'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  projectId: string;
  endpointId: string;
  apiOrigin: string;
}

interface TestFireResult {
  ok: boolean;
  status: number | null;
  durationMs: number;
  responseBody: string | null;
  networkError: string | null;
}

export function TestFireButton({ projectId, endpointId, apiOrigin }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'firing'>('idle');
  const [result, setResult] = useState<TestFireResult | null>(null);
  const [, startTransition] = useTransition();

  async function fire() {
    setPhase('firing');
    setResult(null);
    try {
      const res = await fetch(
        `${apiOrigin}/v1/projects/${projectId}/webhooks/${endpointId}/test-fire`,
        { method: 'POST', credentials: 'include' },
      );
      const json = (await res.json()) as TestFireResult;
      setResult(json);
      // Refresh the server component so the new delivery row (recorded
      // by the public route during the round-trip) lands in the
      // deliveries log without an extra reload.
      startTransition(() => router.refresh());
    } catch (err) {
      setResult({
        ok: false,
        status: null,
        durationMs: 0,
        responseBody: null,
        networkError: err instanceof Error ? err.message : 'fetch failed',
      });
    } finally {
      setPhase('idle');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={fire}
        disabled={phase === 'firing'}
        className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] disabled:opacity-50"
      >
        {phase === 'firing' ? 'firing…' : 'test fire'}
      </button>

      {result ? (
        <div className="md:col-span-2">
          <TestResult result={result} onDismiss={() => setResult(null)} />
        </div>
      ) : null}
    </>
  );
}

function TestResult({
  result,
  onDismiss,
}: {
  result: TestFireResult;
  onDismiss: () => void;
}) {
  const tone = result.ok
    ? 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]'
    : 'border-[var(--color-error)] text-[var(--color-error)]';
  const label = result.networkError
    ? `network · ${result.networkError}`
    : result.status === null
      ? 'no response'
      : `${result.status}${result.ok ? ' ok' : ''}`;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${tone}`}
          >
            {label}
          </span>
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            {result.durationMs}ms
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          dismiss
        </button>
      </div>
      {result.responseBody ? (
        <details className="font-mono text-[10px] text-[var(--color-text-muted)]">
          <summary className="cursor-pointer">response body</summary>
          <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-[var(--color-code-bg)] p-2 text-[var(--color-code-text)]">
            {result.responseBody}
          </pre>
        </details>
      ) : null}
      {!result.ok && !result.networkError ? (
        <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
          {result.status === 401
            ? 'signature rejected — check the secret on your source matches the one shown when you created the webhook.'
            : result.status === 410
              ? 'endpoint is paused — resume it to accept deliveries.'
              : result.status === 502
                ? 'function returned an error. open the deliveries log for the full error message.'
                : 'unexpected response — open the deliveries log for details.'}
        </p>
      ) : null}
    </div>
  );
}
