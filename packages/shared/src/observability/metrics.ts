/**
 * In-process Prometheus exposition — Counter + Histogram + Gauge.
 *
 * Each app calls `createMetricsRegistry({ help })` once at boot to get
 * its own scoped registry; counters/histograms/gauges live inside the
 * registry instance, NOT in module-level state, so per-app namespaces
 * don't bleed into each other and tests can spin up fresh registries.
 *
 * The renderer emits text that scrapes cleanly with a stock Prometheus
 * client. Bucket boundaries are configurable per-registry (default
 * targets HTTP-style request latencies in milliseconds).
 */

export interface CounterValue {
  labels: Record<string, string>;
  value: number;
}

export interface GaugeProvider {
  (): Array<{ labels: Record<string, string>; value: number }>;
}

interface InternalCounter {
  name: string;
  help: string;
  values: Map<string, CounterValue>;
}

interface InternalHistogram {
  name: string;
  help: string;
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

interface InternalGauge {
  name: string;
  help: string;
  provider: GaugeProvider;
}

export interface MetricsRegistryOptions {
  /**
   * Map of metric name → HELP text. Names not present here render with
   * their own name as the help string (acceptable but not ideal). Update
   * the help map when adding a new metric so prometheus.io scrapers see
   * meaningful documentation.
   */
  help?: Record<string, string>;
  /**
   * Histogram bucket upper bounds. Defaults to a request-latency-friendly
   * set (10 / 50 / 100 / 200 / 500 / 1000 / 5000 ms). +Inf is implicit.
   */
  buckets?: readonly number[];
}

export interface MetricsRegistry {
  incCounter(name: string, labels?: Record<string, string>): void;
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void;
  registerGauge(name: string, provider: GaugeProvider): void;
  render(): string;
  /** Test-only — clears all state. */
  reset(): void;
}

const DEFAULT_BUCKETS = [10, 50, 100, 200, 500, 1000, 5000] as const;

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
  return formatLabels({ ...labels, ...extra });
}

export function createMetricsRegistry(options: MetricsRegistryOptions = {}): MetricsRegistry {
  const help = options.help ?? {};
  const buckets = options.buckets ?? DEFAULT_BUCKETS;

  const counters = new Map<string, InternalCounter>();
  const histograms = new Map<string, InternalHistogram>();
  const gauges = new Map<string, InternalGauge>();

  function incCounter(name: string, labels?: Record<string, string>): void {
    let counter = counters.get(name);
    if (!counter) {
      counter = { name, help: help[name] ?? name, values: new Map() };
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

  function observeHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
  ): void {
    let hist = histograms.get(name);
    if (!hist) {
      hist = {
        name,
        help: help[name] ?? name,
        buckets,
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

  function registerGauge(name: string, provider: GaugeProvider): void {
    gauges.set(name, { name, help: help[name] ?? name, provider });
  }

  function render(): string {
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

  function reset(): void {
    counters.clear();
    histograms.clear();
    gauges.clear();
  }

  return { incCounter, observeHistogram, registerGauge, render, reset };
}
