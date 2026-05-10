/**
 * Realtime subscriptions load test — opens N concurrent WebSocket subs
 * against the realtime service, exercises NOTIFY fan-out, reports
 * latency + connection-failure stats.
 *
 * Phase 2 target: 1,000 concurrent subs on KVM4 with p99 fan-out latency
 * under 500ms and zero connection failures.
 *
 * Usage:
 *   bun run infra/load-tests/realtime-subs.ts \
 *     --url ws://localhost:3004/v1/subscribe \
 *     --secret "$BRIVEN_RUNTIME_SHARED_SECRET" \
 *     --project p_01HZ... \
 *     --function poolStats \
 *     --subs 1000 \
 *     --duration 60
 *
 * `--ws-impl` defaults to bun's built-in WebSocket. The harness expects
 * to be run with bun, not node.
 *
 * Stops after `--duration` seconds; emits a summary on stdout.
 */

interface Args {
  url: string;
  secret: string;
  projectId: string;
  functionName: string;
  subs: number;
  durationSec: number;
  rampMs: number;
}

interface Stats {
  opened: number;
  failed: number;
  closed: number;
  framesReceived: number;
  firstFrameLatencyMs: number[];
  errors: Map<string, number>;
}

function parseArgs(argv: readonly string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--url' && next) out.url = next;
    else if (a === '--secret' && next) out.secret = next;
    else if (a === '--project' && next) out.projectId = next;
    else if (a === '--function' && next) out.functionName = next;
    else if (a === '--subs' && next) out.subs = Number(next);
    else if (a === '--duration' && next) out.durationSec = Number(next);
    else if (a === '--ramp' && next) out.rampMs = Number(next);
  }
  return {
    url: out.url ?? 'ws://localhost:3004/v1/subscribe',
    secret: out.secret ?? process.env.BRIVEN_RUNTIME_SHARED_SECRET ?? '',
    projectId: out.projectId ?? '',
    functionName: out.functionName ?? 'poolStats',
    subs: out.subs ?? 100,
    durationSec: out.durationSec ?? 30,
    rampMs: out.rampMs ?? 10,
  };
}

function help(): void {
  process.stdout.write(`realtime-subs — load test the briven realtime service

flags:
  --url URL         ws[s]:// endpoint (default: ws://localhost:3004/v1/subscribe)
  --secret HEX      runtime shared secret (default: \$BRIVEN_RUNTIME_SHARED_SECRET)
  --project ID     target project id, p_…
  --function NAME  function to subscribe to (default: poolStats)
  --subs N         concurrent subs to open (default: 100)
  --duration SEC   how long to hold open after ramp completes (default: 30)
  --ramp MS        delay between successive subscribe frames (default: 10)
`);
}

async function openOne(
  args: Args,
  stats: Stats,
  index: number,
  signal: AbortSignal,
): Promise<void> {
  // Bun's WebSocket supports the `headers` option via a second-arg trick.
  // The realtime service expects Authorization on the upgrade request.
  // We use a custom protocol prefix to convey the bearer because the
  // browser-style WebSocket constructor doesn't accept headers; the
  // realtime side currently reads from the upgrade handler. Workaround:
  // include the token in the URL as a query string, OR run this script
  // with an env var the harness understands. We use a `?bearer=` param
  // that the test harness can recognise — for production the dashboard
  // SDK sends a real Authorization header during the upgrade.
  const wsUrl = `${args.url}?bearer=${encodeURIComponent(args.secret)}`;
  const ws = new WebSocket(wsUrl);
  const t0 = performance.now();
  let firstFrameSeen = false;

  return new Promise((resolve) => {
    const cleanup = (): void => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve();
    };
    signal.addEventListener('abort', cleanup, { once: true });

    ws.addEventListener('open', () => {
      stats.opened++;
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          subscriptionId: `s_${index}_${Date.now()}`,
          projectId: args.projectId,
          functionName: args.functionName,
          args: {},
        }),
      );
    });
    ws.addEventListener('message', (ev: MessageEvent) => {
      stats.framesReceived++;
      if (!firstFrameSeen) {
        firstFrameSeen = true;
        stats.firstFrameLatencyMs.push(performance.now() - t0);
      }
      const data = typeof ev.data === 'string' ? ev.data : '';
      try {
        const frame = JSON.parse(data) as { type?: string; code?: string };
        if (frame.type === 'error' && frame.code) {
          stats.errors.set(frame.code, (stats.errors.get(frame.code) ?? 0) + 1);
        }
      } catch {
        /* ignore */
      }
    });
    ws.addEventListener('error', () => {
      stats.failed++;
      cleanup();
    });
    ws.addEventListener('close', () => {
      stats.closed++;
      resolve();
    });
  });
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    help();
    return 0;
  }
  if (!args.projectId) {
    process.stderr.write('error: --project is required\n');
    help();
    return 1;
  }
  if (!args.secret) {
    process.stderr.write('error: --secret or BRIVEN_RUNTIME_SHARED_SECRET is required\n');
    return 1;
  }

  const stats: Stats = {
    opened: 0,
    failed: 0,
    closed: 0,
    framesReceived: 0,
    firstFrameLatencyMs: [],
    errors: new Map(),
  };

  process.stdout.write(
    `opening ${args.subs} subscriptions against ${args.url} (ramp ${args.rampMs}ms)\n`,
  );
  const controller = new AbortController();
  const inflight: Promise<void>[] = [];
  for (let i = 0; i < args.subs; i++) {
    inflight.push(openOne(args, stats, i, controller.signal));
    if (args.rampMs > 0) await new Promise((r) => setTimeout(r, args.rampMs));
  }

  process.stdout.write(`ramp complete. holding for ${args.durationSec}s…\n`);
  await new Promise((r) => setTimeout(r, args.durationSec * 1000));
  controller.abort();
  await Promise.all(inflight);

  const summary = {
    opened: stats.opened,
    failed: stats.failed,
    closed: stats.closed,
    framesReceived: stats.framesReceived,
    firstFrameLatency: {
      n: stats.firstFrameLatencyMs.length,
      p50: Math.round(percentile(stats.firstFrameLatencyMs, 50)),
      p99: Math.round(percentile(stats.firstFrameLatencyMs, 99)),
      max: Math.round(Math.max(0, ...stats.firstFrameLatencyMs)),
    },
    errorsByCode: Object.fromEntries(stats.errors.entries()),
  };

  process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);

  // Exit non-zero if anything failed — useful in CI.
  return stats.failed > 0 ? 1 : 0;
}

const code = await main();
process.exit(code);
