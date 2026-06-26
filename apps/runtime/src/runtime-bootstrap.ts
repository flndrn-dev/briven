import { resolve } from 'node:path';

import { spawn as bunSpawn } from 'bun';

import { withProjectTx } from './db.js';
import { env } from './env.js';
import { ingestIsolateLogLine } from './log-collector.js';
import { IsolatePoolImpl, type SpawnFn, type SpawnedChild } from './pool-manager.js';
import { fetchProjectEnv } from './project-env-cache.js';

/**
 * Module-level singleton — constructed lazily on first `getPool()` call so
 * importing this module (e.g. for type access) doesn't spin up timers,
 * spawn child processes, or open the data-plane pool. The idle sweeper
 * starts immediately after construction.
 */
let pool: IsolatePoolImpl | null = null;

export function getPool(): IsolatePoolImpl {
  if (pool) return pool;
  pool = new IsolatePoolImpl({
    spawn: bunChildSpawn,
    runtimeStubDir: resolve(import.meta.dir, 'isolate-runtime'),
    isolateBaseDir: env.BRIVEN_RUNTIME_TMP_DIR,
    maxIsolates: env.BRIVEN_RUNTIME_MAX_ISOLATES,
    maxMemoryMb: env.BRIVEN_RUNTIME_ISOLATE_MAX_MEMORY_MB,
    invocationTimeoutMs: env.BRIVEN_RUNTIME_INVOCATION_TIMEOUT_MS,
    idleKillMs: env.BRIVEN_RUNTIME_IDLE_KILL_MS,
    maxInvocationsPerIsolate: env.BRIVEN_RUNTIME_MAX_INVOCATIONS_PER_ISOLATE,
    crashLoopThreshold: env.BRIVEN_RUNTIME_CRASH_LOOP_THRESHOLD,
    crashLoopWindowMs: env.BRIVEN_RUNTIME_CRASH_LOOP_WINDOW_MS,
    runQueryProxy: async (projectId, _requestId, sql, params, _table) => {
      // The host runs the query under the project's tx — exactly the
      // same trust boundary as the inline executor. The isolate never
      // sees raw connection state; it only sees the rows we ship back.
      // @README-BRIVEN ADR 0001: the `pg`-backed `tx.unsafe(sql, params)`
      // adapter (DoltGres via node-postgres) returns the rows directly —
      // same shape callers relied on under the earlier postgres.js path.
      return withProjectTx(projectId, async (tx) => {
        const rows = await tx.unsafe(sql, params as never[]);
        return rows as readonly unknown[];
      });
    },
    loadProjectEnv: fetchProjectEnv,
    onLog: (line, projectId, envValues) => {
      // Phase 1 sink: structured stderr. Task 16 swaps in a Redis-stream
      // publisher so `briven logs --tail` sees isolate logs alongside
      // user logs. envValues is the project's pre-bound env values from
      // the spawn that emitted this line — feeding it into the sanitizer
      // closes the §5.1 redaction loop for isolate panics.
      ingestIsolateLogLine(line, projectId, envValues);
    },
    denoPath: env.BRIVEN_RUNTIME_DENO_PATH,
  });
  pool.startIdleSweeper();
  return pool;
}

/** Test/shutdown hook — drops the singleton so a fresh pool can be built. */
export async function resetPool(): Promise<void> {
  if (!pool) return;
  await pool.shutdown();
  pool = null;
}

/**
 * Adapter that maps Bun's `spawn` API onto the `SpawnFn` interface the
 * pool expects. We pin Deno's binary path from env config and wrap
 * stdout/stderr in newline-stripped async iterators so the pool's reader
 * loops can `await child.stdout.next()` without re-deriving framing.
 */
const bunChildSpawn: SpawnFn = async ({ args, env: childEnv, cwd }) => {
  const proc = bunSpawn({
    cmd: [env.BRIVEN_RUNTIME_DENO_PATH, ...args],
    cwd,
    env: childEnv,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdoutLines = lineIterator(proc.stdout as ReadableStream<Uint8Array>);
  const stderrLines = lineIterator(proc.stderr as ReadableStream<Uint8Array>);

  const child: SpawnedChild = {
    pid: proc.pid,
    stdin: {
      write: async (line: string) => {
        const n = proc.stdin.write(line);
        await proc.stdin.flush();
        return typeof n === 'number' ? n > 0 : Boolean(n);
      },
      end: () => proc.stdin.end(),
    },
    stdout: {
      next: () => stdoutLines.next().then((r) => (r.done ? null : r.value)),
    },
    stderr: {
      next: () => stderrLines.next().then((r) => (r.done ? null : r.value)),
    },
    wait: async () => {
      const exitCode = await proc.exited;
      return { exitCode, signal: null };
    },
    kill: (signal: string) => proc.kill(signal as never),
  };
  return child;
};

/**
 * Decode a Uint8Array stream into one yielded string per `\n`-terminated
 * line. Drops the trailing newline. If the stream ends with a partial
 * line we yield it before completing — Deno panics typically arrive that
 * way and we'd otherwise lose them.
 */
async function* lineIterator(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      if (buf.length > 0) yield buf;
      return;
    }
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line) yield line;
    }
  }
}
