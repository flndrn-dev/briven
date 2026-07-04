'use client';

import { motion } from 'motion/react';
import { useId } from 'react';

/**
 * Hand-rolled animated SVG area/line chart — no chart library. The line
 * draws itself in on mount (motion pathLength), the gradient fill fades
 * in behind it. Subsequent data updates (live polling) morph the path
 * without replaying the entrance, so a 10s poll never flickers.
 *
 * Strokes use vectorEffect="non-scaling-stroke" so the stretched
 * (preserveAspectRatio="none") viewBox never distorts line weight.
 */

export interface AreaChartPoint {
  x: number;
  y: number;
}

export interface AreaChartProps {
  data: readonly AreaChartPoint[];
  /** chart body height in px (labels add a little more). default 200. */
  height?: number;
  yFormat?: (y: number) => string;
  xFormat?: (x: number) => string;
  ariaLabel?: string;
  /** shown centered while fewer than 2 points exist. */
  pendingLabel?: string;
}

const VB_W = 600;
const VB_H = 200;

export function AreaChart({
  data,
  height = 200,
  yFormat = (y) => y.toLocaleString('en-US', { maximumFractionDigits: 1 }),
  xFormat = (x) => new Date(x).toLocaleTimeString(),
  ariaLabel,
  pendingLabel = 'collecting data — the chart fills in as live samples arrive.',
}: AreaChartProps) {
  const gradientId = useId();

  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)]"
        style={{ height }}
      >
        <p className="font-mono text-xs text-[var(--color-text-subtle)]">{pendingLabel}</p>
      </div>
    );
  }

  const first = data[0]!;
  const last = data[data.length - 1]!;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of data) {
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  // Breathe a little so the line never kisses the frame edges.
  const pad = (yMax - yMin || Math.abs(yMax) || 1) * 0.12;
  const lo = yMin - pad;
  const hi = yMax + pad;
  const xSpan = last.x - first.x || 1;
  const ySpan = hi - lo || 1;

  const coords = data.map((p) => ({
    x: ((p.x - first.x) / xSpan) * VB_W,
    y: VB_H - ((p.y - lo) / ySpan) * VB_H,
  }));
  const lineD = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(' ');
  const areaD = `${lineD} L${VB_W},${VB_H} L0,${VB_H} Z`;

  return (
    <div role="img" aria-label={ariaLabel} className="flex flex-col gap-2">
      <div className="flex gap-3">
        {/* y-axis labels — plain HTML so the stretched svg can't distort them */}
        <div
          className="flex w-14 shrink-0 flex-col justify-between py-0.5 text-right font-mono text-[10px] text-[var(--color-text-subtle)]"
          style={{ height }}
        >
          <span>{yFormat(yMax)}</span>
          <span>{yFormat((yMax + yMin) / 2)}</span>
          <span>{yFormat(yMin)}</span>
        </div>

        <div className="relative min-w-0 flex-1" style={{ height }}>
          {/* horizontal gridlines */}
          <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            <div className="border-t border-[var(--color-border-subtle)]" />
            <div className="border-t border-dashed border-[var(--color-border-subtle)]" />
            <div className="border-t border-[var(--color-border-subtle)]" />
          </div>

          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            aria-hidden
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <motion.path
              d={areaD}
              fill={`url(#${gradientId})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.9, delay: 0.5, ease: 'easeOut' }}
            />
            <motion.path
              d={lineD}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
            />
          </svg>
        </div>
      </div>

      {/* x-axis labels */}
      <div className="flex justify-between pl-[68px] font-mono text-[10px] text-[var(--color-text-subtle)]">
        <span>{xFormat(first.x)}</span>
        <span>{xFormat(last.x)}</span>
      </div>
    </div>
  );
}
