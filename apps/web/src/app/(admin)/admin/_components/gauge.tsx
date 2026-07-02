'use client';

import { motion } from 'motion/react';

import { CountUp } from './stat-card';

/**
 * Donut gauge for host load (CPU / RAM / disk). The arc sweeps in with a
 * motion tween and the % label counts up alongside it.
 *
 * HARD honesty rule: `percent === null` renders a muted empty ring with
 * "—" in the middle and a "no data" note — never a fabricated 0%.
 */

export interface GaugeProps {
  label: string;
  /** 0–100, or null when the metric isn't available. */
  percent: number | null;
  /** small line under the label, e.g. "6.2 / 15.6 GB". */
  detail?: string;
  /** percent at/above which the ring turns red. default 85. */
  redAt?: number;
  /** percent at/above which the ring turns amber. default 70. */
  amberAt?: number;
  /** outer diameter in px. default 140. */
  size?: number;
  icon?: React.ReactNode;
}

const STROKE = 10;

export function Gauge({
  label,
  percent,
  detail,
  redAt = 85,
  amberAt = 70,
  size = 140,
  icon,
}: GaugeProps) {
  const clamped = percent === null ? null : Math.min(100, Math.max(0, percent));
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const targetOffset =
    clamped === null ? circumference : circumference * (1 - clamped / 100);

  const ringColor =
    clamped === null
      ? 'var(--color-border-strong)'
      : clamped >= redAt
        ? 'var(--color-error)'
        : clamped >= amberAt
          ? 'var(--color-warning)'
          : 'var(--color-primary)';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex h-full flex-col items-center gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6"
    >
      <p className="flex items-center gap-2 self-start font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {icon ? <span className="text-[var(--color-text-muted)]">{icon}</span> : null}
        {label}
      </p>

      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="meter"
          aria-valuenow={clamped === null ? undefined : Math.round(clamped)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          {/* track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-border-subtle)"
            strokeWidth={STROKE}
          />
          {/* value arc — sweeps in from empty */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: targetOffset }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {clamped === null ? (
            <span className="font-mono text-3xl text-[var(--color-text-subtle)]">—</span>
          ) : (
            <CountUp
              value={clamped}
              decimals={0}
              suffix="%"
              className="font-mono text-3xl tracking-tight text-[var(--color-text)]"
            />
          )}
        </div>
      </div>

      <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">
        {clamped === null ? 'no data' : (detail ?? ' ')}
      </p>
    </motion.div>
  );
}
