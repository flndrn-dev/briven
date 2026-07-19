'use client';

import { useState } from 'react';

interface Props {
  value: string;
  label?: string;
}

export function EnterpriseCopyButton({ value, label = 'copy' }: Props) {
  const [copied, setCopied] = useState(false);

  function onCopy(): void {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
    >
      {copied ? 'copied' : label}
    </button>
  );
}
