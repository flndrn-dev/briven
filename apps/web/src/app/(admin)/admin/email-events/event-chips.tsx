'use client';

import { motion } from 'motion/react';

import { CountUp } from '../_components/stat-card';

/**
 * Animated event-type count chips for the email-events page. Each chip
 * fades/slides in with a small stagger and its count counts up. Counts
 * are computed server-side from the REAL fetched events — this component
 * only animates what it's given (honest-data rule).
 */

export interface EventChip {
  type: string;
  count: number;
  severity: 'ok' | 'warn' | 'fail';
}

const SEVERITY_CLASS: Record<EventChip['severity'], string> = {
  ok: 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]',
  fail: 'border-red-500/40 bg-red-500/10 text-red-400',
  warn: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
};

export function EventChips({ chips }: { chips: readonly EventChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {chips.map((c, i) => (
        <motion.span
          key={c.type}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: i * 0.05, ease: 'easeOut' }}
          className={`inline-flex items-baseline gap-2 rounded-full border px-3 py-1.5 font-mono text-xs ${SEVERITY_CLASS[c.severity]}`}
        >
          {c.type}
          <CountUp value={c.count} className="font-mono text-xs" />
        </motion.span>
      ))}
    </div>
  );
}
