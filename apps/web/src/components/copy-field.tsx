'use client';

import { useRef, useState } from 'react';

import { CopyIcon } from './animated-icons';

interface Props {
  value: string;
  label?: string;
}

/**
 * Read-only text input paired with a copy-to-clipboard icon button. On
 * click the icon morphs into a checkmark for ~1.5s. Selection of the
 * input contents on focus makes the value easy to grab manually too.
 */
export function CopyField({ value, label }: Props) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback: select and prompt execCommand — rarely needed in 2026 browsers.
      inputRef.current?.select();
      document.execCommand?.('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex w-full items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-1 pr-1">
      <input
        ref={inputRef}
        type="text"
        readOnly
        value={value}
        aria-label={label ?? 'copyable value'}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 bg-transparent px-2 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none"
      />
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'copied' : 'copy to clipboard'}
        className="flex size-8 shrink-0 items-center justify-center rounded border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border)] hover:text-[var(--color-primary)]"
      >
        <CopyIcon className="size-4" copied={copied} />
      </button>
    </div>
  );
}
