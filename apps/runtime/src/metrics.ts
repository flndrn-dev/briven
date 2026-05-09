/**
 * Tiny in-process Prometheus exposition module.
 *
 * Three primitives — Counter, Histogram, Gauge — each keyed by metric name
 * and a stable serialization of label key→value pairs. The renderer walks
 * the maps and emits text that scrapes cleanly with a stock Prometheus
 * client; the parser is forgiving on whitespace and label ordering, so we
 * don't bother sorting beyond what's needed for label-key stability.
 *
 * The pool gauges are pull-based: `registerPoolGauges()` stashes a
 * reference to the pool, and `renderPrometheus()` snapshots
 * `describeForMetrics()` at scrape time. That keeps the lifecycle hot
 * paths (spawn, invoke) free of gauge bookkeeping.
 */

interface Counter {
  name: string;
  help: string;
  values: Map<string, { labels: Record<string, string>; value: number }>;
}

interface Histogram {
  name: string;
  help: string;
  /** Bucket upper bounds in ms. +Inf is implicit. */
  buckets: readonly number[];
  values: Map<
    string,
    {
      labels: Record<string, string>;
      bucketCounts: number[];
      sum: number;
      count: number;
    }
  >;
}

interface Gauge {
  name: string;
  help: string;
  /** Pull-based provider — called at render time. */
  provider: () => Array<{ labels: Record<string, string>; value: number }>;
}

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();
const gauges = new Map<string, Gauge>();

const DEFAULT_BUCKETS = [10, 50, 100, 200, 500, 1000, 5000] as const;

const HELP: Record<string, string> = {
  briven_runtime_invocations_total: 'Total invocations completed',
  briven_runtime_invocation_duration_ms: 'Invocation duration (ms)',
  briven_runtime_isolate_spawns_total: 'Total isolate spawn attempts by outcome',
  briven_runtime_cold_start_ms: 'Isolate cold-start latency (ms)',
  briven_runtime_isolate_kills_total: 'Total isolate kills by reason',
  briven_runtime_crash_loop_breaks_total: 'Crash-loop breaker trips',
  briven_runtime_pool_size: 'Total isolates in pool',
  briven_runtime_isolates_by_state: 'Isolates in each lifecycle state',
};

function labelKey(labels: Record<string, string> | undefined): string {
  if (!labels) return '';
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join(',');
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabels(labels: Record<string, string>): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  const parts = keys.map((k) => `${k}="${escapeLabelValue(labels[k] ?? '')}"`);
  return `{${parts.join(',')}}`;
}

function formatLabelsWith(
  labels: Record<string, string>,
  extra: Record<string, string>,
): string {
  const merged: Record<string, string> = { ...labels, ...extra };
  return formatLabels(merged);
}

export function incCounter(name: string, labels?: Record<string, string>): void {
  let counter = counters.get(name);
  if (!counter) {
    counter = {
      name,
      help: HELP[name] ?? name,
      values: new Map(),
    };
    counters.set(name, counter);
  }
  const key = labelKey(labels);
  const existing = counter.values.get(key);
  if (existing) {
    existing.value += 1;
  } else {
    counter.values.set(key, { labels: { ...(labels ?? {}) }, value: 1 });
  }
}

export function observeHistogram(
  name: string,
  value: number,
  labels?: Record<string, string>,
): void {
  let hist = histograms.get(name);
  if (!hist) {
    hist = {
      name,
      help: HELP[name] ?? name,
      buckets: DEFAULT_BUCKETS,
      values: new Map(),
    };
    histograms.set(name, hist);
  }
  const key = labelKey(labels);
  let entry = hist.values.get(key);
  if (!entry) {
    entry = {
      labels: { ...(labels ?? {}) },
      bucketCounts: new Array(hist.buckets.length).fill(0),
      sum: 0,
      count: 0,
    };
    hist.values.set(key, entry);
  }
  entry.sum += value;
  entry.count += 1;
  for (let i = 0; i < hist.buckets.length; i += 1) {
    const upper = hist.buckets[i];
    if (upper !== undefined && value <= upper) {
      entry.bucketCounts[i] = (entry.bucketCounts[i] ?? 0) + 1;
    }
  }
}

export function registerPoolGauges(pool: {
  describeForMetrics(): { isolatesByState: Record<string, number>; poolSize: number };
}): void {
  gauges.set('briven_runtime_pool_size', {
    name: 'briven_runtime_pool_size',
    help: HELP['briven_runtime_pool_size'] ?? 'pool size',
    provider: () => {
      const snap = pool.describeForMetrics();
      return [{ labels: {}, value: snap.poolSize }];
    },
  });
  gauges.set('briven_runtime_isolates_by_state', {
    name: 'briven_runtime_isolates_by_state',
    help: HELP['briven_runtime_isolates_by_state'] ?? 'isolates by state',
    provider: () => {
      const snap = pool.describeForMetrics();
      return Object.entries(snap.isolatesByState).map(([state, value]) => ({
        labels: { state },
        value,
      }));
    },
  });
}

export function renderPrometheus(): string {
  const out: string[] = [];

  for (const counter of counters.values()) {
    out.push(`# HELP ${counter.name} ${counter.help}`);
    out.push(`# TYPE ${counter.name} counter`);
    if (counter.values.size === 0) {
      out.push(`${counter.name} 0`);
    } else {
      for (const v of counter.values.values()) {
        out.push(`${counter.name}${formatLabels(v.labels)} ${v.value}`);
      }
    }
    out.push('');
  }

  for (const hist of histograms.values()) {
    out.push(`# HELP ${hist.name} ${hist.help}`);
    out.push(`# TYPE ${hist.name} histogram`);
    if (hist.values.size === 0) {
      for (const upper of hist.buckets) {
        out.push(`${hist.name}_bucket{le="${upper}"} 0`);
      }
      out.push(`${hist.name}_bucket{le="+Inf"} 0`);
      out.push(`${hist.name}_sum 0`);
      out.push(`${hist.name}_count 0`);
    } else {
      for (const v of hist.values.values()) {
        for (let i = 0; i < hist.buckets.length; i += 1) {
          const upper = hist.buckets[i] ?? 0;
          const count = v.bucketCounts[i] ?? 0;
          out.push(
            `${hist.name}_bucket${formatLabelsWith(v.labels, { le: String(upper) })} ${count}`,
          );
        }
        out.push(
          `${hist.name}_bucket${formatLabelsWith(v.labels, { le: '+Inf' })} ${v.count}`,
        );
        out.push(`${hist.name}_sum${formatLabels(v.labels)} ${v.sum}`);
        out.push(`${hist.name}_count${formatLabels(v.labels)} ${v.count}`);
      }
    }
    out.push('');
  }

  for (const gauge of gauges.values()) {
    out.push(`# HELP ${gauge.name} ${gauge.help}`);
    out.push(`# TYPE ${gauge.name} gauge`);
    let entries: Array<{ labels: Record<string, string>; value: number }> = [];
    try {
      entries = gauge.provider();
    } catch {
      entries = [];
    }
    if (entries.length === 0) {
      out.push(`${gauge.name} 0`);
    } else {
      for (const e of entries) {
        out.push(`${gauge.name}${formatLabels(e.labels)} ${e.value}`);
      }
    }
    out.push('');
  }

  return `${out.join('\n')}\n`;
}

/**
 * Test-only: clear all counter/histogram/gauge state. Avoid calling from
 * production code — there's only one process-wide registry.
 */
export function resetMetrics(): void {
  counters.clear();
  histograms.clear();
  gauges.clear();
}
