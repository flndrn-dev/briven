import { toValidDate } from '@/lib/utils';

interface Hour {
  hour: string;
  count: number;
  errCount: number;
}

/**
 * Tiny inline SVG bar chart. No deps, no client JS — server-rendered.
 * Renders one bar per hour; height scales to the max bar in the series.
 * Error count overlays the bar in red.
 */
export function InvocationsSparkline({ hours }: { hours: Hour[] }) {
  if (hours.length === 0) return null;
  const total = hours.reduce((acc, h) => acc + h.count, 0);
  if (total === 0) return null;
  const max = Math.max(...hours.map((h) => h.count));
  const W = 280;
  const H = 40;
  const barW = W / hours.length;
  const gap = 1;

  return (
    <div className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        aria-label="invocations per hour, last 24 hours"
      >
        {hours.map((h, i) => {
          const barH = max === 0 ? 0 : Math.max(1, (h.count / max) * H);
          const errH = max === 0 ? 0 : (h.errCount / max) * H;
          return (
            <g key={i}>
              <rect
                x={i * barW + gap / 2}
                y={H - barH}
                width={barW - gap}
                height={barH}
                fill="var(--color-primary)"
                opacity={0.6}
              >
                <title>{`${toValidDate(h.hour)?.toISOString().slice(11, 16) ?? '—'} · ${h.count} invocations${h.errCount > 0 ? ` · ${h.errCount} err` : ''}`}</title>
              </rect>
              {errH > 0 ? (
                <rect
                  x={i * barW + gap / 2}
                  y={H - errH}
                  width={barW - gap}
                  height={errH}
                  fill="#f87171"
                  opacity={0.9}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between font-mono text-[9px] text-[var(--color-text-subtle)]">
        <span>−24h</span>
        <span>{total.toLocaleString()} invocations</span>
        <span>now</span>
      </div>
    </div>
  );
}
