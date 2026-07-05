'use client';

import { useState } from 'react';

export function CopyLink({ url }: { url: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  async function onClick() {
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  }

  const label = state === 'copied' ? 'copied ✓' : state === 'error' ? 'failed' : 'copy';

  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-md border border-[var(--color-border-subtle)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
      title="copy public url to clipboard"
    >
      {label}
    </button>
  );
}
