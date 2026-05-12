'use client';

import { useState } from 'react';

export function CopySchemaButton({ projectId }: { projectId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'copied' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onClick() {
    setState('loading');
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/studio/schema.ts`);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `http ${res.status}`);
      }
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'copy failed');
      setTimeout(() => setState('idle'), 3000);
    }
  }

  const label =
    state === 'loading'
      ? 'generating…'
      : state === 'copied'
        ? 'copied!'
        : state === 'error'
          ? 'failed'
          : 'copy as schema.ts';

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={state === 'loading'}
        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
        title="generate the equivalent briven/schema.ts and copy to clipboard"
      >
        {label}
      </button>
      {errorMsg ? (
        <p className="font-mono text-[10px] text-red-400">{errorMsg}</p>
      ) : null}
    </div>
  );
}
