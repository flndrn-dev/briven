'use client';

import { useState } from 'react';

import { CopyIcon } from './animated-icons';

/**
 * Bare copy-to-clipboard icon button for inline use next to a value that
 * is rendered elsewhere (unlike CopyField, which owns its own input).
 * On click the copy glyph morphs into the checkmark for ~1.5s.
 */
export function CopyChip({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API can be unavailable on insecure contexts; nothing to
      // fall back to here since the value isn't in an input we own.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'copied' : `copy ${label ?? 'value'} to clipboard`}
      className="flex size-7 shrink-0 items-center justify-center rounded border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border)] hover:text-[var(--color-primary)]"
    >
      <CopyIcon className="size-3.5" copied={copied} />
    </button>
  );
}
