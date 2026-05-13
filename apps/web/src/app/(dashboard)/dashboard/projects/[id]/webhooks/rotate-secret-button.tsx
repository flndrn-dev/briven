'use client';

import { useState } from 'react';

interface Props {
  projectId: string;
  endpointId: string;
  endpointName: string;
  apiOrigin: string;
}

export function RotateSecretButton({ projectId, endpointId, endpointName, apiOrigin }: Props) {
  const [phase, setPhase] = useState<'idle' | 'confirming' | 'rotating' | 'revealed' | 'error'>(
    'idle',
  );
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  async function rotate() {
    setPhase('rotating');
    setError(null);
    try {
      const res = await fetch(
        `${apiOrigin}/v1/projects/${projectId}/webhooks/${endpointId}/rotate-secret`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `rotate failed: ${res.status}`);
      }
      const json = (await res.json()) as { plaintextSecret: string };
      setSecret(json.plaintextSecret);
      setPhase('revealed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'rotate failed');
      setPhase('error');
    }
  }

  if (phase === 'revealed' && secret) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] p-3 md:col-span-2">
        <p className="font-mono text-xs text-[var(--color-primary)]">
          new signing secret for &quot;{endpointName}&quot; — copy now, shown once
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md bg-[var(--color-code-bg)] px-3 py-2 font-mono text-xs text-[var(--color-code-text)]">
            {revealed ? secret : '•'.repeat(48)}
          </code>
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {revealed ? 'hide' : 'show'}
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(secret)}
            className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            copy
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setSecret(null);
            setPhase('idle');
            setRevealed(false);
          }}
          className="self-start font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          dismiss
        </button>
      </div>
    );
  }

  if (phase === 'confirming') {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-[var(--color-warning)]">
          rotating invalidates the old secret immediately —
        </span>
        <button
          type="button"
          onClick={rotate}
          className="rounded-md border border-[var(--color-warning)] px-2 py-1 font-mono text-[10px] text-[var(--color-warning)] hover:bg-[var(--color-warning)] hover:text-[var(--color-text-inverse)]"
        >
          rotate now
        </button>
        <button
          type="button"
          onClick={() => setPhase('idle')}
          className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          cancel
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={phase === 'rotating'}
        onClick={() => setPhase('confirming')}
        className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] disabled:opacity-50"
      >
        {phase === 'rotating' ? 'rotating…' : 'rotate secret'}
      </button>
      {phase === 'error' && error ? (
        <span className="font-mono text-[10px] text-[var(--color-error)]">{error}</span>
      ) : null}
    </>
  );
}
