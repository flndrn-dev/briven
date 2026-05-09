import { newId } from '@briven/shared';

import {
  cleanupIsolate,
  materializeIsolate,
  sweepOrphans,
} from './bundle-materializer.js';
import { sanitizeErrorMessage } from './error-sanitizer.js';
import type { LogLine, RuntimeErrorCode } from './isolate-runtime/types.js';
import { incCounter, observeHistogram } from './metrics.js';
import { formatDenyNet } from './network-filter.js';
import type { Bundle, InvokeRequest, InvokeResult } from './types.js';

export type IsolateState = 'spawning' | 'ready' | 'in_flight' | 'retiring' | 'dead';

export interface IsolateEntry {
  isolateId: string;
  projectId: string;
  deploymentId: string;
  state: IsolateState;
  pid: number;
  invocationCount: number;
  /** ms epoch — last time the isolate finished work or accepted an invoke. */
  lastActivityAt: number;
  tmpDir: string;
  /** ms epoch — when the isolate process was spawned. */
  createdAt: number;
  /** Per-(projectId, deploymentId) consecutive crashes; cleared on success. */
  consecutiveCrashes: number;
  /** Per-spawn env values used for §5.1 redaction in log/error sanitizers. */
  envValues: readonly string[];
}

export type StateEvent =
  | { kind: 'spawn_ready' }
  | { kind: 'invoke_start' }
  | { kind: 'invoke_complete' }
  | { kind: 'retire' }
  | { kind: 'crash' }
  | { kind: 'exit' };

/**
 * Pure state-transition function. Returns a new entry; does not mutate.
 *
 *   spawning  --spawn_ready-->  ready
 *   ready     --invoke_start--> in_flight
 *   in_flight --invoke_complete--> ready
 *   *         --retire-->       retiring
 *   *         --crash-->        dead
 *   *         --exit-->         dead
 *
 * Invalid transitions are silently no-op (state unchanged) — callers should
 * not depend on this for safety; check state first.
 */
export function transitionState(entry: IsolateEntry, evt: StateEvent): IsolateEntry {
  let next: IsolateState = entry.state;
  switch (evt.kind) {
    case 'spawn_ready':
      if (entry.state === 'spawning') next = 'ready';
      break;
    case 'invoke_start':
      if (entry.state === 'ready') next = 'in_flight';
      break;
    case 'invoke_complete':
      if (entry.state === 'in_flight') next = 'ready';
      break;
    case 'retire':
      next = 'retiring';
      break;
    case 'crash':
      next = 'dead';
      break;
    case 'exit':
      next = 'dead';
      break;
  }
  return { ...entry, state: next };
}

export type KillReason =
  | 'idle'
  | 'max_invocations'
  | 'crash'
  | 'deploy_invalidation'
  | 'host_cap_evict';

/**
 * Decide whether a ready isolate should be killed based on activity and
 * invocation count. Returns null if the isolate is fine, or a reason
 * string for the metric label.
 *
 * Triggers checked here (CLAUDE.md §7.3):
 *   - idle > idleKillMs   →  'idle'
 *   - invocationCount ≥ maxInvocations  →  'max_invocations'
 *
 * Other kill triggers (crash, deploy_invalidation, host_cap_evict) are
 * decided elsewhere and surfaced through the same KillReason union for
 * metrics consistency.
 */
export function computeKillReason(
  entry: IsolateEntry,
  config: { idleKillMs: number; maxInvocations: number },
  now: number = Date.now(),
): KillReason | null {
  if (entry.state !== 'ready') return null;
  if (entry.invocationCount >= config.maxInvocations) return 'max_invocations';
  if (now - entry.lastActivityAt >= config.idleKillMs) return 'idle';
  return null;
}

/**
 * The full PoolManager interface. Implementation arrives in Task 10+.
 * The stub class for `PoolManager` here gives downstream tasks something
 * to import as a type.
 */
export interface PoolManager {
  invoke(bundle: Bundle, request: InvokeRequest): Promise<InvokeResult>;
  shutdown(): Promise<void>;
  startIdleSweeper(): void;
  describeForMetrics(): {
    isolatesByState: Record<IsolateState, number>;
    poolSize: number;
  };
}

export interface SpawnedChild {
  pid: number;
  stdin: {
    write: (line: string) => boolean | Promise<boolean | number>;
    end: () => void;
  };
  /** Yields newline-stripped stdout lines; null on EOF. */
  stdout: { next: () => Promise<string | null> };
  /** Yields newline-stripped stderr lines; null on EOF. */
  stderr: { next: () => Promise<string | null> };
  wait: () => Promise<{ exitCode: number; signal: number | null }>;
  kill: (signal: string) => void;
}

export interface SpawnFn {
  (opts: {
    args: string[];
    env: Record<string, string>;
    cwd: string;
  }): Promise<SpawnedChild>;
}

export interface IsolatePoolConfig {
  spawn: SpawnFn;
  runtimeStubDir: string;
  isolateBaseDir: string;
  maxIsolates: number;
  maxMemoryMb: number;
  invocationTimeoutMs: number;
  idleKillMs: number;
  maxInvocationsPerIsolate: number;
  crashLoopThreshold: number;
  crashLoopWindowMs: number;
  runQueryProxy: (
    projectId: string,
    requestId: string,
    sql: string,
    params: readonly unknown[],
    table: string,
  ) => Promise<readonly unknown[]>;
  onLog: (line: LogLine, projectId: string, envValues: readonly string[]) => void;
  loadProjectEnv: (projectId: string) => Promise<Record<string, string>>;
  denoPath?: string;
}

interface CrashHistory {
  /** ms timestamps of recent crashes */
  crashes: number[];
}

type ResultEnvelope =
  | { type: 'result'; requestId: string; value: unknown; durationMs: number }
  | { type: 'error'; requestId: string; code: string; message: string; durationMs: number };

/**
 * Error codes that mean the underlying isolate is dead or its IO channel is
 * unusable. When a result envelope carries one of these, the entry must NOT
 * be transitioned back to ready — the next invoke needs a cold start.
 */
const CRASH_CODES: ReadonlySet<RuntimeErrorCode> = new Set<RuntimeErrorCode>([
  'invocation_timeout',
  'isolate_crashed',
  'isolate_spawn_timeout',
  'isolate_protocol_error',
]);

export class IsolatePoolImpl implements PoolManager {
  private readonly map = new Map<string, IsolateEntry>();
  private readonly children = new Map<string, SpawnedChild>();
  private readonly crashHistory = new Map<string, CrashHistory>();
  private readonly readyWaiters = new Map<string, Array<() => void>>();
  private readonly resultResolvers = new Map<string, (msg: ResultEnvelope) => void>();
  private readonly touchedTablesByRequest = new Map<string, Set<string>>();
  /** Track which isolateIds have a stdout reader running. */
  private readonly stdoutReaders = new Set<string>();
  /**
   * Per-projectId in-flight cold-start promise. Two concurrent invokes for
   * the same projectId await the same spawn promise rather than each
   * spawning a new isolate. Per CLAUDE.md §5.2: at most one live isolate
   * per project.
   */
  private readonly pendingSpawns = new Map<string, Promise<IsolateEntry>>();
  private shutdownInProgress = false;
  private idleSweeperHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: IsolatePoolConfig) {}

  async invoke(bundle: Bundle, request: InvokeRequest): Promise<InvokeResult> {
    if (this.shutdownInProgress) {
      return errResult('host_overloaded', 'runtime shutting down');
    }
    if (!bundle.functionNames.includes(request.functionName)) {
      return errResult('function_not_found', `function '${request.functionName}' not found`);
    }

    const breakerKey = `${request.projectId}:${request.deploymentId}`;
    if (this.isCrashLoopBroken(breakerKey)) {
      return errResult(
        'deployment_unhealthy',
        'deployment marked unhealthy after repeated crashes',
      );
    }

    let entry = this.map.get(request.projectId);

    // Deploy invalidation: deployment changed → retire and respawn.
    if (entry && entry.deploymentId !== request.deploymentId) {
      await this.retireAndAwait(entry, 'deploy_invalidation');
      entry = undefined;
    }

    // Single-flight queueing: if an entry exists but is in-flight, wait
    // for it to return to ready before piggybacking the next invoke.
    if (entry && entry.state === 'in_flight') {
      await this.waitForReady(request.projectId);
      entry = this.map.get(request.projectId);
      if (!entry || entry.deploymentId !== request.deploymentId) {
        // Mid-wait the entry was retired or deploy-invalidated; fall
        // back through the full flow.
        return this.invoke(bundle, request);
      }
    }

    if (!entry) {
      // C1 fix: gate concurrent cold-starts on a per-project promise so
      // two parallel invokes don't both spawn. Per CLAUDE.md §5.2.
      let spawnPromise = this.pendingSpawns.get(request.projectId);
      const isInitiator = !spawnPromise;
      if (!spawnPromise) {
        // Host-cap eviction: if at maxIsolates, retire the oldest idle
        // entry before spawning a fresh one. If no idle entry exists the
        // invoke falls through and runs (we let downstream metrics/alerts
        // catch sustained over-cap rather than fail hard here).
        if (this.map.size >= this.config.maxIsolates) {
          await this.evictOldestIdle();
        }
        spawnPromise = this.spawnIsolate(bundle).finally(() => {
          this.pendingSpawns.delete(request.projectId);
        });
        this.pendingSpawns.set(request.projectId, spawnPromise);
      }
      try {
        entry = await spawnPromise;
      } catch (err) {
        // `spawnIsolate` already emitted the `timeout` counter; everything
        // else falls into `spawn_error` (materialization failure, exec
        // not-found, OOM during ready handshake, …).
        const tagged = err as Error & { spawnOutcome?: string };
        if (tagged.spawnOutcome !== 'timeout') {
          incCounter('briven_runtime_isolate_spawns_total', { outcome: 'spawn_error' });
        }
        this.recordCrash(breakerKey);
        return errResult(
          'isolate_spawn_timeout',
          err instanceof Error ? err.message : 'spawn failed',
        );
      }
      // Only the spawn-initiating caller writes the entry + starts the
      // readers; concurrent awaiters observe the entry already in the map.
      if (isInitiator && !this.map.has(request.projectId)) {
        this.map.set(request.projectId, entry);
        this.startStdoutReader(entry);
        this.startStderrReader(entry);
        this.watchForExit(entry);
      }
    }

    return this.runInvoke(entry, request);
  }

  private async spawnIsolate(bundle: Bundle): Promise<IsolateEntry> {
    const spawnStart = performance.now();
    const isolateId = newId('iso');
    const mat = await materializeIsolate(isolateId, bundle, {
      isolateBaseDir: this.config.isolateBaseDir,
      runtimeStubDir: this.config.runtimeStubDir,
    });

    const userEnv = await this.config.loadProjectEnv(bundle.projectId);
    const allowEnvKeys = Object.keys(userEnv).join(',');
    // Bind env values now so log/error sanitizers can redact them per §5.1.
    const envValues: readonly string[] = Object.values(userEnv).filter(
      (v): v is string => typeof v === 'string',
    );

    const args: string[] = [
      'run',
      '--no-prompt',
      '--no-remote',
      '--allow-net',
      `--deny-net=${formatDenyNet()}`,
      `--allow-read=${mat.tmpDir}`,
      `--allow-write=${mat.tmpDir}`,
      `--v8-flags=--max-old-space-size=${this.config.maxMemoryMb}`,
      `--import-map=${mat.importMapPath}`,
    ];
    if (allowEnvKeys) args.splice(args.indexOf('--allow-net'), 0, `--allow-env=${allowEnvKeys}`);
    args.push(mat.entryPath);

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...userEnv,
    };

    const child = await this.config.spawn({ args, env, cwd: mat.tmpDir });

    // Wait for ready handshake — 500ms timeout (twice the cold-start budget).
    const readyLine = await Promise.race([
      child.stdout.next(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);
    if (!readyLine) {
      // Drain a few stderr lines so the host log surfaces Deno's actual error
      // (e.g. flag-parse failure) rather than a generic timeout.
      const stderrLines: string[] = [];
      for (let i = 0; i < 5; i++) {
        const line = await Promise.race([
          child.stderr.next(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
        ]);
        if (line === null) break;
        stderrLines.push(line);
      }
      child.kill('SIGTERM');
      await cleanupIsolate(mat.tmpDir);
      incCounter('briven_runtime_isolate_spawns_total', { outcome: 'timeout' });
      // Tag the error so the caller in `invoke()` can attribute it to
      // 'timeout' rather than the generic 'spawn_error' bucket.
      const stderrTail = stderrLines.length > 0 ? `; stderr: ${stderrLines.join(' | ')}` : '';
      const err = new Error(`isolate did not emit ready within 500ms${stderrTail}`);
      (err as Error & { spawnOutcome?: string }).spawnOutcome = 'timeout';
      throw err;
    }
    let parsed: { type?: string; deploymentId?: string };
    try {
      parsed = JSON.parse(readyLine);
    } catch {
      child.kill('SIGKILL');
      await cleanupIsolate(mat.tmpDir);
      throw new Error('isolate ready handshake malformed');
    }
    if (parsed.type !== 'ready' || parsed.deploymentId !== bundle.deploymentId) {
      child.kill('SIGKILL');
      await cleanupIsolate(mat.tmpDir);
      throw new Error(
        `isolate ready handshake mismatch: got ${JSON.stringify(parsed)}`,
      );
    }
    const entry: IsolateEntry = {
      isolateId,
      projectId: bundle.projectId,
      deploymentId: bundle.deploymentId,
      state: 'ready',
      pid: child.pid,
      invocationCount: 0,
      lastActivityAt: Date.now(),
      tmpDir: mat.tmpDir,
      createdAt: Date.now(),
      consecutiveCrashes: 0,
      envValues,
    };
    this.children.set(isolateId, child);
    incCounter('briven_runtime_isolate_spawns_total', { outcome: 'success' });
    observeHistogram(
      'briven_runtime_cold_start_ms',
      Math.round(performance.now() - spawnStart),
    );
    return entry;
  }

  /**
   * Reads stdout lines from the child in a loop. Dispatches:
   *   - `query`         → forward to `runQueryProxy`, send `query_result` back.
   *   - `result`/`error`→ resolve the matching `resultResolvers` entry.
   *
   * On JSON parse failure we SIGKILL the child (the protocol is broken)
   * and stop reading. The reader is started after a successful spawn
   * and runs until the child closes stdout.
   */
  private startStdoutReader(entry: IsolateEntry): void {
    if (this.stdoutReaders.has(entry.isolateId)) return;
    this.stdoutReaders.add(entry.isolateId);
    const child = this.children.get(entry.isolateId);
    if (!child) return;

    const projectId = entry.projectId;
    const isolateId = entry.isolateId;

    void (async () => {
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const line = await child.stdout.next();
          if (line === null) return;
          if (!line.trim()) continue;
          let msg: { type?: string; [k: string]: unknown };
          try {
            msg = JSON.parse(line);
          } catch {
            // Protocol break — drain any pending resolvers so callers don't
            // wait the full invocation timeout for a result that will never
            // arrive once we kill the child below.
            this.drainResolversWith(
              'isolate_protocol_error',
              'malformed output from isolate',
            );
            child.kill('SIGKILL');
            return;
          }
          if (msg.type === 'query') {
            const requestId = msg.requestId as string;
            const qid = msg.qid as string;
            const sql = msg.sql as string;
            const params = (msg.params as readonly unknown[]) ?? [];
            const table = msg.table as string;
            const tables = this.touchedTablesByRequest.get(requestId);
            if (tables) tables.add(table);
            let writePayload: string;
            try {
              const rows = await this.config.runQueryProxy(
                projectId,
                requestId,
                sql,
                params,
                table,
              );
              writePayload = `${JSON.stringify({ type: 'query_result', requestId, qid, rows })}\n`;
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              writePayload = `${JSON.stringify({
                type: 'query_result',
                requestId,
                qid,
                error: { code: 'function_threw', message },
              })}\n`;
            }
            try {
              await child.stdin.write(writePayload);
            } catch (err) {
              // Stdin closed mid-query — child is dead. Drain pending
              // resolvers so callers see the truthful error code rather
              // than waiting for a 30s timeout.
              const message = err instanceof Error ? err.message : 'isolate stdin closed';
              this.drainResolversWith('isolate_crashed', message);
              try {
                child.kill('SIGKILL');
              } catch {
                /* ignore */
              }
              return;
            }
          } else if (msg.type === 'result' || msg.type === 'error') {
            const requestId = msg.requestId as string;
            const resolver = this.resultResolvers.get(requestId);
            if (resolver) {
              this.resultResolvers.delete(requestId);
              resolver(msg as unknown as ResultEnvelope);
            }
          }
          // Anything else (logs, unknown types) → ignore at this layer.
        }
      } finally {
        this.stdoutReaders.delete(isolateId);
      }
    })();
  }

  /**
   * Reads stderr lines from the child in a loop. Each line is parsed as
   * JSON and, if it shapes as a `LogLine` envelope, routed to
   * `config.onLog`. Anything that doesn't parse — or doesn't match the
   * envelope — is treated as a raw stderr panic (Deno crash trace,
   * unhandled rejection trail, etc.) and surfaced as an error-level
   * log so ops still sees it.
   *
   * The reader exits when stderr returns null (EOF). It does not kill
   * the child on parse errors — the protocol is stdout-only; stderr is
   * advisory.
   */
  private startStderrReader(entry: IsolateEntry): void {
    const child = this.children.get(entry.isolateId);
    if (!child) return;
    const projectId = entry.projectId;
    const envValues = entry.envValues;
    void (async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const line = await child.stderr.next();
        if (line === null) return;
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { type?: string };
          if (parsed && parsed.type === 'log') {
            this.config.onLog(parsed as LogLine, projectId, envValues);
            continue;
          }
        } catch {
          /* fallthrough to raw-line capture */
        }
        this.config.onLog(
          {
            type: 'log',
            requestId: null,
            level: 'error',
            msg: line,
            ts: Date.now(),
          },
          projectId,
          envValues,
        );
      }
    })();
  }

  /**
   * Find the entry in `ready` state with the oldest `lastActivityAt`
   * and retire it. Used when a cold-start would push us past
   * `maxIsolates`. If no ready entry exists (every isolate is busy),
   * returns without doing anything — the caller proceeds with the
   * spawn anyway and pool size briefly exceeds the cap.
   */
  private async evictOldestIdle(): Promise<void> {
    let oldest: IsolateEntry | null = null;
    for (const e of this.map.values()) {
      if (e.state !== 'ready') continue;
      if (!oldest || e.lastActivityAt < oldest.lastActivityAt) oldest = e;
    }
    if (!oldest) return;
    await this.retireAndAwait(oldest, 'host_cap_evict');
  }

  private async runInvoke(entry: IsolateEntry, request: InvokeRequest): Promise<InvokeResult> {
    const child = this.children.get(entry.isolateId);
    if (!child) {
      const r = errResult('isolate_crashed', 'isolate child handle missing');
      this.emitInvocationMetrics(r);
      return r;
    }

    // 1. Transition to in_flight.
    let updated = transitionState(entry, { kind: 'invoke_start' });
    this.map.set(request.projectId, updated);

    // 2. Track touched tables for this requestId.
    this.touchedTablesByRequest.set(request.requestId, new Set<string>());

    // 3+4. Promise + timeout.
    const started = performance.now();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const envelope = await new Promise<ResultEnvelope>((resolve) => {
      this.resultResolvers.set(request.requestId, resolve);
      timeoutHandle = setTimeout(() => {
        if (!this.resultResolvers.has(request.requestId)) return;
        this.resultResolvers.delete(request.requestId);
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        resolve({
          type: 'error',
          requestId: request.requestId,
          code: 'invocation_timeout',
          message: `invocation exceeded ${this.config.invocationTimeoutMs}ms`,
          durationMs: Math.round(performance.now() - started),
        });
      }, this.config.invocationTimeoutMs);

      // 5. Write invoke frame.
      const frame: { type: 'invoke' } & Omit<InvokeRequest, 'projectId' | 'deploymentId' | 'env'> = {
        type: 'invoke',
        requestId: request.requestId,
        functionName: request.functionName,
        args: request.args,
        auth: request.auth,
      };
      void Promise.resolve(child.stdin.write(`${JSON.stringify(frame)}\n`)).catch(() => {
        if (!this.resultResolvers.has(request.requestId)) return;
        this.resultResolvers.delete(request.requestId);
        resolve({
          type: 'error',
          requestId: request.requestId,
          code: 'isolate_crashed',
          message: 'failed to write invoke frame to isolate stdin',
          durationMs: Math.round(performance.now() - started),
        });
      });
    });
    if (timeoutHandle) clearTimeout(timeoutHandle);

    // 7. Build the InvokeResult.
    const touched = this.touchedTablesByRequest.get(request.requestId) ?? new Set<string>();
    this.touchedTablesByRequest.delete(request.requestId);
    const touchedTables = [...touched];

    let result: InvokeResult;
    if (envelope.type === 'result') {
      result = {
        ok: true,
        value: envelope.value,
        durationMs: envelope.durationMs,
        touchedTables,
      };
    } else {
      // §5.1: every customer-visible error message that flows through the
      // host passes through the sanitizer with the isolate's bound env
      // values so a panic echoing a secret can't leak it.
      result = {
        ok: false,
        code: envelope.code as RuntimeErrorCode,
        message: sanitizeErrorMessage(envelope.message, entry.envValues),
        durationMs: envelope.durationMs,
        touchedTables,
      };
    }

    // 8. Transition back to ready — but only if the isolate is still
    //    healthy. Crash-coded errors mean the child is dead (or its IO
    //    channel is unusable); putting that entry back into ready state
    //    would trick the next invoke into writing to a dead pipe.
    const after = this.map.get(request.projectId);
    const isCrashCoded = !result.ok && CRASH_CODES.has(result.code);
    if (after && after.state === 'in_flight') {
      if (isCrashCoded) {
        // Don't put a dead isolate back into ready state. Mark it gone
        // and remove it from the map so the next invoke cold-starts.
        this.map.delete(request.projectId);
        this.children.delete(after.isolateId);
        // Drain ready waiters so any queued invoke gets a chance to spawn fresh.
        const waiters = this.readyWaiters.get(request.projectId) ?? [];
        this.readyWaiters.delete(request.projectId);
        for (const w of waiters) w();
        // Best-effort tmp dir cleanup; don't await on the hot path.
        void cleanupIsolate(after.tmpDir).catch(() => {});
      } else {
        updated = transitionState(after, { kind: 'invoke_complete' });
        updated = {
          ...updated,
          invocationCount: updated.invocationCount + 1,
          lastActivityAt: Date.now(),
        };
        this.map.set(request.projectId, updated);

        // Drain ready waiters for this project.
        const waiters = this.readyWaiters.get(request.projectId);
        if (waiters && waiters.length > 0) {
          this.readyWaiters.delete(request.projectId);
          for (const w of waiters) w();
        }

        // Max-invocations retire.
        if (updated.invocationCount >= this.config.maxInvocationsPerIsolate) {
          // Fire-and-forget — the next invoke for this projectId will spawn fresh.
          void this.retireAndAwait(updated, 'max_invocations');
        }
      }
    }

    // 11. Crash bookkeeping.
    const breakerKey = `${request.projectId}:${request.deploymentId}`;
    if (
      !result.ok &&
      (result.code === 'isolate_crashed' || result.code === 'isolate_spawn_timeout')
    ) {
      this.recordCrash(breakerKey);
    } else if (result.ok) {
      this.crashHistory.delete(breakerKey);
    }

    this.emitInvocationMetrics(result);
    return result;
  }

  /**
   * Single emit point for `briven_runtime_invocations_total` and
   * `briven_runtime_invocation_duration_ms`. Centralized so every
   * `runInvoke` exit goes through the same pair, regardless of whether
   * the failure was ours (timeout, crash) or the user's (function_threw).
   */
  private emitInvocationMetrics(result: InvokeResult): void {
    const code = result.ok ? 'success' : result.code;
    incCounter('briven_runtime_invocations_total', { code });
    observeHistogram('briven_runtime_invocation_duration_ms', result.durationMs);
  }

  /**
   * Reject every pending in-flight invocation with the given error code +
   * message. Used whenever the protocol breaks (malformed stdout, stdin
   * write failure, shutdown) — without this, callers wait the full
   * `invocationTimeoutMs` for a result that will never arrive.
   */
  private drainResolversWith(code: RuntimeErrorCode, message: string): void {
    for (const [reqId, resolve] of this.resultResolvers) {
      resolve({
        type: 'error',
        requestId: reqId,
        code,
        message,
        durationMs: 0,
      });
    }
    this.resultResolvers.clear();
  }

  private recordCrash(key: string): void {
    const now = Date.now();
    const hist = this.crashHistory.get(key) ?? { crashes: [] };
    const wasBroken = hist.crashes.length >= this.config.crashLoopThreshold;
    hist.crashes.push(now);
    // Trim entries outside the window so the array doesn't grow unbounded.
    const cutoff = now - this.config.crashLoopWindowMs;
    hist.crashes = hist.crashes.filter((t) => t >= cutoff);
    this.crashHistory.set(key, hist);
    const isBroken = hist.crashes.length >= this.config.crashLoopThreshold;
    // Edge-trigger: only emit on the (threshold-1)→threshold transition,
    // not every subsequent crash inside the same broken window. The
    // history naturally resets once `crashLoopWindowMs` passes, after
    // which the next crash that re-trips the breaker fires this again.
    if (!wasBroken && isBroken) {
      incCounter('briven_runtime_crash_loop_breaks_total');
    }
  }

  /**
   * Returns true when the (projectId, deploymentId) key has crashed at
   * least `crashLoopThreshold` times within `crashLoopWindowMs`. Trims
   * stale entries on read so deployments self-heal once the window
   * passes without further crashes.
   */
  private isCrashLoopBroken(key: string): boolean {
    const hist = this.crashHistory.get(key);
    if (!hist) return false;
    const now = Date.now();
    hist.crashes = hist.crashes.filter((t) => now - t < this.config.crashLoopWindowMs);
    if (hist.crashes.length === 0) {
      this.crashHistory.delete(key);
      return false;
    }
    return hist.crashes.length >= this.config.crashLoopThreshold;
  }

  /**
   * SIGCHLD-equivalent: awaits the child process exit and reconciles
   * pool state. If the entry is still the live one for its project,
   * transitions to crash/exit (both → dead), drains pending resolvers,
   * and removes the entry from the maps. Tmp dir cleanup is fire-and-
   * forget — failure to unlink shouldn't block the next spawn.
   */
  private watchForExit(entry: IsolateEntry): void {
    const child = this.children.get(entry.isolateId);
    if (!child) return;
    void child.wait().then(({ exitCode, signal }) => {
      const current = this.map.get(entry.projectId);
      if (!current || current.isolateId !== entry.isolateId) return;
      const updated = transitionState(
        current,
        signal != null || exitCode !== 0 ? { kind: 'crash' } : { kind: 'exit' },
      );
      this.map.set(entry.projectId, updated);
      if (updated.state === 'dead') {
        // `watchForExit` is the only path that reaches the `dead` state
        // outside `retireAndAwait`, so we emit the kill counter here
        // rather than threading a reason through every transition.
        // Both crash (non-zero exit / signal) and clean exit count as
        // 'crash' for ops purposes — a clean exit from a long-lived
        // isolate is unexpected and worth alerting on.
        incCounter('briven_runtime_isolate_kills_total', { reason: 'crash' });
        this.children.delete(entry.isolateId);
        this.map.delete(entry.projectId);
        this.drainResolversWith(
          'isolate_crashed',
          `isolate exited (code=${exitCode}, signal=${signal})`,
        );
        void cleanupIsolate(entry.tmpDir);
      }
    });
  }

  /**
   * @internal
   * Test-only — runs one tick of the idle sweeper synchronously. Mirrors
   * the body of the interval started by `startIdleSweeper`. Production
   * code uses the timed interval; tests use this hook to deterministically
   * exercise the idle-kill path without waiting for the 30s tick.
   */
  public async triggerIdleCheck(): Promise<void> {
    if (this.shutdownInProgress) return;
    const now = Date.now();
    for (const entry of [...this.map.values()]) {
      const reason = computeKillReason(
        entry,
        {
          idleKillMs: this.config.idleKillMs,
          maxInvocations: this.config.maxInvocationsPerIsolate,
        },
        now,
      );
      if (reason) await this.retireAndAwait(entry, reason);
    }
  }

  /**
   * Schedule a 30s sweep that retires any ready entry whose lastActivity
   * exceeded `idleKillMs` or whose invocationCount hit
   * `maxInvocationsPerIsolate`. Idempotent — calling twice is a no-op.
   * Cleared in `shutdown()`.
   */
  startIdleSweeper(): void {
    if (this.idleSweeperHandle) return;
    this.idleSweeperHandle = setInterval(() => {
      if (this.shutdownInProgress) return;
      const now = Date.now();
      for (const entry of [...this.map.values()]) {
        const reason = computeKillReason(
          entry,
          {
            idleKillMs: this.config.idleKillMs,
            maxInvocations: this.config.maxInvocationsPerIsolate,
          },
          now,
        );
        if (reason) void this.retireAndAwait(entry, reason);
      }
    }, 30_000);
  }

  /**
   * Single-flight queue: returns a promise that resolves once the
   * in-flight invoke for `projectId` finishes and the entry is back
   * to ready (or the entry is removed).
   */
  private waitForReady(projectId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const list = this.readyWaiters.get(projectId) ?? [];
      list.push(resolve);
      this.readyWaiters.set(projectId, list);
    });
  }

  /**
   * Graceful retire: send shutdown frame, escalate to SIGTERM at 5s and
   * SIGKILL at 7s, then clean up the tmp dir. Removes the entry from
   * the pool map so the next invoke spawns fresh.
   *
   * `reason` is recorded as a label on `briven_runtime_isolate_kills_total`
   * — pass the trigger (idle sweeper, max-invocations, deploy switch,
   * host-cap eviction). Crash kills go through `watchForExit` and emit
   * separately, since that path doesn't reach this method.
   */
  private async retireAndAwait(
    entry: IsolateEntry,
    reason: KillReason = 'idle',
  ): Promise<void> {
    incCounter('briven_runtime_isolate_kills_total', { reason });
    const retired = transitionState(entry, { kind: 'retire' });
    this.map.set(entry.projectId, retired);
    const child = this.children.get(entry.isolateId);
    if (child) {
      try {
        await child.stdin.write('{"type":"shutdown"}\n');
      } catch {
        /* ignore */
      }
      const sigtermHandle = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }, 5000);
      const sigkillHandle = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 7000);
      // Don't keep the event loop alive on these timers in tests.
      if (typeof sigtermHandle === 'object' && sigtermHandle && 'unref' in sigtermHandle) {
        (sigtermHandle as { unref: () => void }).unref();
      }
      if (typeof sigkillHandle === 'object' && sigkillHandle && 'unref' in sigkillHandle) {
        (sigkillHandle as { unref: () => void }).unref();
      }
    }
    await cleanupIsolate(entry.tmpDir);
    // Only remove if still pointing at this entry (a re-spawn may have
    // already replaced it under our feet).
    const current = this.map.get(entry.projectId);
    if (current && current.isolateId === entry.isolateId) {
      this.map.delete(entry.projectId);
    }
    this.children.delete(entry.isolateId);
  }

  describeForMetrics() {
    const isolatesByState: Record<IsolateState, number> = {
      spawning: 0,
      ready: 0,
      in_flight: 0,
      retiring: 0,
      dead: 0,
    };
    for (const e of this.map.values()) isolatesByState[e.state]++;
    return { isolatesByState, poolSize: this.map.size };
  }

  async shutdown(): Promise<void> {
    this.shutdownInProgress = true;
    if (this.idleSweeperHandle) {
      clearInterval(this.idleSweeperHandle);
      this.idleSweeperHandle = null;
    }
    // Drain in-flight resolvers FIRST so callers don't hang waiting for
    // results that will never arrive once we kill the children below.
    this.drainResolversWith('isolate_crashed', 'runtime shutting down');
    for (const child of this.children.values()) {
      try { await child.stdin.write('{"type":"shutdown"}\n'); } catch { /* ignore */ }
      setTimeout(() => child.kill('SIGTERM'), 5000);
      setTimeout(() => child.kill('SIGKILL'), 7000);
    }
    this.crashHistory.clear();
    await sweepOrphans(this.config.isolateBaseDir, new Set());
  }
}

function errResult(code: RuntimeErrorCode, message: string): InvokeResult {
  return { ok: false, code, message, durationMs: 0 };
}
