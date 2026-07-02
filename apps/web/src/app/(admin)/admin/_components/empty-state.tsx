'use client';

import { motion } from 'motion/react';

/**
 * Friendly, spacious empty/error placeholder — replaces the old cramped
 * one-liner. Give it an icon, a plain-words message, and (for error
 * states) an action like a retry button.
 */
export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-8 py-16 text-center"
    >
      {icon ? <span className="text-[var(--color-text-muted)]">{icon}</span> : null}
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-sm text-[var(--color-text)]">{title}</p>
        {message ? (
          <p className="mx-auto max-w-md font-mono text-xs leading-relaxed text-[var(--color-text-subtle)]">
            {message}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </motion.div>
  );
}

/** House-styled action button for EmptyState (e.g. "retry"). */
export function EmptyStateButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2 font-mono text-xs text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-primary)] disabled:opacity-50"
    >
      {children}
    </button>
  );
}
