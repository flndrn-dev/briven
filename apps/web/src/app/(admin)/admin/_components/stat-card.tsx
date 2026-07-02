'use client';

import { animate, useMotionValue, useTransform, motion } from 'motion/react';
import { useEffect } from 'react';

/**
 * Command-deck stat card: a big number that counts up on mount (and glides
 * to new values as live polling updates it), with an optional delta chip
 * and an optional sparkline.
 *
 * HARD honesty rule (house-wide): `value === null` renders "—" plus what
 * the number is waiting on — never a fabricated 0. The count-up only ever
 * animates REAL numbers the api returned.
 */

/** Animated number — springs from its current displayed value to `value`. */
export function CountUp({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) =>
    `${prefix}${v.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`,
  );

  useEffect(() => {
    const controls = animate(mv, value, { duration: 1.1, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [mv, value]);

  return <motion.span className={className}>{text}</motion.span>;
}

/** Tiny inline sparkline that draws itself in. Renders nothing below 2 points. */
export function Sparkline({
  points,
  className,
}: {
  points: readonly number[];
  className?: string;
}) {
  if (points.length < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  const range = max - min || 1;
  const step = 100 / (points.length - 1);
  const d = points
    .map((p, i) => {
      const x = i * step;
      // 2px vertical padding inside the 28-unit-tall viewBox.
      const y = 26 - ((p - min) / range) * 24;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className={className ?? 'h-7 w-full'}
      aria-hidden
    >
      <motion.path
        d={d}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0, opacity: 0.4 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
    </svg>
  );
}

export interface StatCardProps {
  label: string;
  /** null = data not available yet — renders the honest "—". */
  value: number | null;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /** e.g. { value: +4, label: 'last 24h' } — tone follows the sign. */
  delta?: { value: number; label: string } | null;
  /** small line under the number when a value IS shown. */
  hint?: string;
  /** small line under the "—" explaining what the number waits on. */
  waitingOn?: string;
  /** raw series for the sparkline; omit (or < 2 points) to hide it. */
  sparkline?: readonly number[];
  tone?: 'default' | 'primary' | 'warning';
  icon?: React.ReactNode;
}

const TONE_CLASS: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'text-[var(--color-text)]',
  primary: 'text-[var(--color-primary)]',
  warning: 'text-[var(--color-warning)]',
};

export function StatCard({
  label,
  value,
  prefix = '',
  suffix = '',
  decimals = 0,
  delta,
  hint,
  waitingOn,
  sparkline,
  tone = 'default',
  icon,
}: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex h-full flex-col gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6"
    >
      <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {icon ? <span className="text-[var(--color-text-muted)]">{icon}</span> : null}
        {label}
      </p>

      {value === null ? (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-4xl tracking-tight text-[var(--color-text-subtle)]">—</p>
          {waitingOn ? (
            <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">{waitingOn}</p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-3">
            <CountUp
              value={value}
              decimals={decimals}
              prefix={prefix}
              suffix={suffix}
              className={`font-mono text-4xl tracking-tight ${TONE_CLASS[tone]}`}
            />
            {delta ? <DeltaChip delta={delta} /> : null}
          </div>
          {hint ? (
            <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">{hint}</p>
          ) : null}
        </div>
      )}

      {sparkline && sparkline.length >= 2 ? (
        <div className="mt-auto">
          <Sparkline points={sparkline} />
        </div>
      ) : null}
    </motion.div>
  );
}

function DeltaChip({ delta }: { delta: { value: number; label: string } }) {
  const positive = delta.value > 0;
  const flat = delta.value === 0;
  const toneClass = flat
    ? 'text-[var(--color-text-subtle)]'
    : positive
      ? 'text-[var(--color-primary)]'
      : 'text-[var(--color-error)]';
  const sign = positive ? '+' : '';
  return (
    <span className={`font-mono text-xs ${toneClass}`}>
      {sign}
      {delta.value.toLocaleString('en-US')} {delta.label}
    </span>
  );
}
