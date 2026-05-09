import { beforeEach, describe, expect, test } from 'bun:test';

import {
  incCounter,
  observeHistogram,
  registerPoolGauges,
  renderPrometheus,
  resetMetrics,
} from '../src/metrics.js';

describe('metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  test('renders counters in Prometheus format', () => {
    incCounter('test_counter', { label: 'a' });
    incCounter('test_counter', { label: 'a' });
    incCounter('test_counter', { label: 'b' });
    const out = renderPrometheus();
    expect(out).toContain('test_counter{label="a"} 2');
    expect(out).toContain('test_counter{label="b"} 1');
    expect(out).toContain('# TYPE test_counter counter');
  });

  test('renders histogram with buckets', () => {
    observeHistogram('test_histogram', 5);
    observeHistogram('test_histogram', 25);
    observeHistogram('test_histogram', 150);
    const out = renderPrometheus();
    expect(out).toContain('test_histogram_bucket{le="10"} 1');
    expect(out).toContain('test_histogram_bucket{le="50"} 2');
    expect(out).toContain('test_histogram_bucket{le="200"} 3');
    expect(out).toContain('test_histogram_bucket{le="+Inf"} 3');
    expect(out).toMatch(/test_histogram_count\s+3/);
    expect(out).toMatch(/test_histogram_sum\s+180/);
    expect(out).toContain('# TYPE test_histogram histogram');
  });

  test('exposes pool gauges from the registered provider', () => {
    const fakePool = {
      describeForMetrics: () => ({
        isolatesByState: { ready: 2, in_flight: 1, spawning: 0, retiring: 0, dead: 0 },
        poolSize: 3,
      }),
    };
    registerPoolGauges(fakePool);
    const out = renderPrometheus();
    expect(out).toContain('# TYPE briven_runtime_pool_size gauge');
    expect(out).toContain('briven_runtime_pool_size 3');
    expect(out).toContain('briven_runtime_isolates_by_state{state="ready"} 2');
    expect(out).toContain('briven_runtime_isolates_by_state{state="in_flight"} 1');
  });
});
