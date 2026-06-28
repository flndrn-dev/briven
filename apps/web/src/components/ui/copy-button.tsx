'use client';

import { useCallback, useState } from 'react';

import { CopyIcon } from './copy';

interface CopyButtonProps {
  /** The exact text written to the clipboard. */
  value: string;
  /** Accessible label / tooltip in the idle state. */
  label?: string;
  /** Icon size in px. */
  size?: number;
  /** Show a text label next to the icon (button style) instead of icon-only. */
  showLabel?: boolean;
  className?: string;
}

/**
 * One-click copy with honest feedback: clicking copies `value` and flashes a
 * thick green check for ~2s so the user can SEE it worked, then reverts to the
 * copy icon. Reused for non-secret identifiers (endpoint, project id) and for
 * a freshly-minted API key while its plaintext is still on screen.
 */
export function CopyButton({
  value,
  label = 'copy',
  size = 14,
  showLabel = false,
  className = '',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(() => {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  }, [value]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? 'copied' : label}
      title={copied ? 'copied!' : label}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md p-1 text-[var(--color-text-subtle)] transition hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] ${className}`}
    >
      {copied ? (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--color-primary)]"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <CopyIcon size={size} aria-hidden="true" />
      )}
      {showLabel ? (
        <span className={`font-mono text-xs ${copied ? 'text-[var(--color-primary)]' : ''}`}>
          {copied ? 'copied!' : label}
        </span>
      ) : null}
    </button>
  );
}
