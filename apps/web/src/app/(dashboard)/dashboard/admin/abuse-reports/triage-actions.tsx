'use client';

import { useState } from 'react';

const RESOLUTIONS = ['no_action', 'warned', 'suspended', 'banned'] as const;
type Resolution = (typeof RESOLUTIONS)[number];

interface Props {
  reportId: string;
  currentStatus: 'open' | 'triaged' | 'resolved';
  onTriage: (reportId: string) => Promise<void>;
  onResolve: (reportId: string, resolution: Resolution) => Promise<void>;
}

export function TriageActions({ reportId, currentStatus, onTriage, onResolve }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Resolution>('no_action');

  async function triage() {
    setPending(true);
    setError(null);
    try {
      await onTriage(reportId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'triage failed');
    } finally {
      setPending(false);
    }
  }

  async function resolve() {
    setPending(true);
    setError(null);
    try {
      await onResolve(reportId, resolution);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'resolve failed');
    } finally {
      setPending(false);
    }
  }

  if (currentStatus === 'resolved') {
    return (
      <span className="font-mono text-xs text-[var(--color-text-subtle)]">resolved</span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {currentStatus === 'open' ? (
          <button
            type="button"
            onClick={triage}
            disabled={pending}
            className="rounded-md border border-[var(--color-border)] px-3 py-1 font-mono text-xs hover:bg-[var(--color-surface)] disabled:opacity-60"
          >
            {pending ? '…' : 'triage'}
          </button>
        ) : null}
        <select
          value={resolution}
          onChange={(e) => setResolution(e.target.value as Resolution)}
          disabled={pending}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 font-mono text-xs"
        >
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={resolve}
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
        >
          {pending ? '…' : 'resolve'}
        </button>
      </div>
      {error ? (
        <span className="font-mono text-xs text-[var(--color-text-error)]">{error}</span>
      ) : null}
    </div>
  );
}
