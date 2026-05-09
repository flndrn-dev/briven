// Shared harness for runtime integration tests. Materializes a real
// on-disk bundle, spawns a real Deno isolate via the same `bunChildSpawn`
// adapter the production bootstrap uses, runs ONE invocation, returns the
// `InvokeResult` plus a teardown callback.
//
// Tasks 17–22 all share this helper. Keep it test-agnostic: no test-name
// branching, no hard-coded fixtures beyond the "@briven/cli/server" stub.

import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { spawn as bunSpawn } from 'bun';

import { IsolatePoolImpl, type SpawnFn, type SpawnedChild } from '../../src/pool-manager.js';
import type { Bundle, InvokeRequest, InvokeResult } from '../../src/types.js';

// Resolve the Deno binary at fixture time (not module load) so each test
// can override via env. Falls through to the default install path on the
// dev machine, then to bare `deno` on PATH (CI).
function resolveDenoPath(): string {
  return process.env.BRIVEN_RUNTIME_DENO_PATH ?? '/Users/flndrn/.deno/bin/deno';
}

export interface FixtureOpts {
  /** Source code for the customer function. Written to briven/functions/<fnName>.ts */
  fnSource: string;
  /** Function name (matches the export and the file name). */
  fnName: string;
  /** Deployment ID echoed in the ready handshake. */
  deploymentId: string;
  /** Optional: extra config overrides on the pool. */
  poolConfig?: Partial<{
    invocationTimeoutMs: number;
    idleKillMs: number;
    maxInvocationsPerIsolate: number;
    maxMemoryMb: number;
    maxIsolates: number;
    crashLoopThreshold: number;
    crashLoopWindowMs: number;
  }>;
  /** Optional: surface isolate stderr lines (for debugging a failing test). */
  onLog?: (line: unknown, projectId: string) => void;
  /** Optional: project env vars exposed via Deno.env (allow-env list). */
  projectEnv?: Record<string, string>;
}

export interface FixtureResult {
  result: InvokeResult;
  pool: IsolatePoolImpl;
  cleanup: () => Promise<void>;
}

/**
 * Materialize a fake bundle on disk, construct a pool against the real
 * Deno binary, run one invoke, return the result + the pool (for tests
 * that want to inspect state) + a cleanup callback.
 *
 * The caller MUST call `cleanup()` even on error (use try/finally).
 */
export async function runIntegrationFixture(opts: FixtureOpts): Promise<FixtureResult> {
  const workDir = await mkdtemp(join(tmpdir(), 'briven-int-'));
  const bundleDir = join(workDir, 'bundle');
  const isolateBase = join(workDir, 'isolates');
  const runtimeStubDir = join(workDir, 'stub');

  // Vendor the real isolate-runtime stubs into the work dir. The
  // materializer will copy them again into the per-isolate tmp dir, but
  // it expects them to live under `runtimeStubDir`.
  const realStubDir = resolve(import.meta.dir, '..', '..', 'src', 'isolate-runtime');
  await mkdir(runtimeStubDir, { recursive: true });
  for (const f of ['loop.ts', 'server.ts', 'types.ts']) {
    await copyFile(join(realStubDir, f), join(runtimeStubDir, f));
  }

  // Customer function source.
  await mkdir(join(bundleDir, 'functions'), { recursive: true });
  await writeFile(join(bundleDir, 'functions', `${opts.fnName}.ts`), opts.fnSource);

  await mkdir(isolateBase, { recursive: true });

  const bundle: Bundle = {
    projectId: 'p-int',
    deploymentId: opts.deploymentId,
    functionNames: [opts.fnName],
    directory: bundleDir,
  };
  const request: InvokeRequest = {
    projectId: 'p-int',
    functionName: opts.fnName,
    args: {},
    deploymentId: opts.deploymentId,
    requestId: `req-${Date.now()}`,
    auth: null,
  };

  const denoPath = resolveDenoPath();
  const spawn = makeBunChildSpawn(denoPath);

  const pool = new IsolatePoolImpl({
    spawn,
    runtimeStubDir,
    isolateBaseDir: isolateBase,
    maxIsolates: opts.poolConfig?.maxIsolates ?? 50,
    maxMemoryMb: opts.poolConfig?.maxMemoryMb ?? 128,
    invocationTimeoutMs: opts.poolConfig?.invocationTimeoutMs ?? 30_000,
    idleKillMs: opts.poolConfig?.idleKillMs ?? 10 * 60_000,
    maxInvocationsPerIsolate: opts.poolConfig?.maxInvocationsPerIsolate ?? 1000,
    crashLoopThreshold: opts.poolConfig?.crashLoopThreshold ?? 3,
    crashLoopWindowMs: opts.poolConfig?.crashLoopWindowMs ?? 60_000,
    runQueryProxy: async () => [],
    onLog: (line, projectId) => {
      if (opts.onLog) opts.onLog(line, projectId);
    },
    loadProjectEnv: async () => opts.projectEnv ?? {},
    denoPath,
  });

  const result = await pool.invoke(bundle, request);

  const cleanup = async () => {
    await pool.shutdown();
    await rm(workDir, { recursive: true, force: true });
  };

  return { result, pool, cleanup };
}

/**
 * Adapter that maps Bun's `spawn` API onto the `SpawnFn` interface the
 * pool expects. Mirrors `apps/runtime/src/runtime-bootstrap.ts` —
 * intentionally duplicated for now (Phase 2 may extract a shared helper).
 */
function makeBunChildSpawn(denoPath: string): SpawnFn {
  return async ({ args, env: childEnv, cwd }) => {
    const proc = bunSpawn({
      cmd: [denoPath, ...args],
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
}

// ---------------------------------------------------------------------------
// Multi-invocation helpers — used by Tasks 20–22.
//
// All three reuse the same per-test scratch dir layout `runIntegrationFixture`
// builds (one workDir, one runtimeStubDir, one isolateBase). They diverge only
// on how many bundles they materialize and how many invokes they fire against
// the same pool.
// ---------------------------------------------------------------------------

/** Vendor stub files into runtimeStubDir. Mirrors `runIntegrationFixture`. */
async function vendorRuntimeStubs(runtimeStubDir: string): Promise<void> {
  await mkdir(runtimeStubDir, { recursive: true });
  const realStubDir = resolve(import.meta.dir, '..', '..', 'src', 'isolate-runtime');
  for (const f of ['loop.ts', 'server.ts', 'types.ts']) {
    await copyFile(join(realStubDir, f), join(runtimeStubDir, f));
  }
}

/**
 * Wrap a SpawnFn so each spawn's `child.pid` is recorded into `sink`.
 * Used by `runTwoSequentialInvocations` and `runIdleKillFixture` to prove
 * a respawn happened (different PID).
 */
function withPidRecorder(inner: SpawnFn, sink: number[]): SpawnFn {
  return async (opts) => {
    const child = await inner(opts);
    sink.push(child.pid);
    return child;
  };
}

export interface TwoInvocationsOpts {
  first: { fnSource: string; fnName: string; deploymentId: string };
  second: { fnSource: string; fnName: string; deploymentId: string };
  poolConfig?: FixtureOpts['poolConfig'];
}

export interface TwoInvocationsResult {
  first: InvokeResult;
  second: InvokeResult;
  /** PIDs observed across the two invocations. Should be 2 distinct values for deploy invalidation. */
  pidsObserved: number[];
  cleanup: () => Promise<void>;
}

/**
 * Two sequential invocations against the SAME pool/projectId, with two
 * different `deploymentId`s and two separately-materialized bundles. The
 * second invocation triggers deploy-invalidation: the first isolate is
 * retired and a fresh one cold-starts. PIDs are tracked via a wrapped
 * SpawnFn so the test can assert two distinct PIDs.
 */
export async function runTwoSequentialInvocations(
  opts: TwoInvocationsOpts,
): Promise<TwoInvocationsResult> {
  const workDir = await mkdtemp(join(tmpdir(), 'briven-int-'));
  const bundleDirA = join(workDir, 'bundle-a');
  const bundleDirB = join(workDir, 'bundle-b');
  const isolateBase = join(workDir, 'isolates');
  const runtimeStubDir = join(workDir, 'stub');
  await vendorRuntimeStubs(runtimeStubDir);

  await mkdir(join(bundleDirA, 'functions'), { recursive: true });
  await writeFile(join(bundleDirA, 'functions', `${opts.first.fnName}.ts`), opts.first.fnSource);
  await mkdir(join(bundleDirB, 'functions'), { recursive: true });
  await writeFile(join(bundleDirB, 'functions', `${opts.second.fnName}.ts`), opts.second.fnSource);
  await mkdir(isolateBase, { recursive: true });

  const denoPath = resolveDenoPath();
  const pidsObserved: number[] = [];
  const spawn = withPidRecorder(makeBunChildSpawn(denoPath), pidsObserved);

  const pool = new IsolatePoolImpl({
    spawn,
    runtimeStubDir,
    isolateBaseDir: isolateBase,
    maxIsolates: opts.poolConfig?.maxIsolates ?? 50,
    maxMemoryMb: opts.poolConfig?.maxMemoryMb ?? 128,
    invocationTimeoutMs: opts.poolConfig?.invocationTimeoutMs ?? 30_000,
    idleKillMs: opts.poolConfig?.idleKillMs ?? 10 * 60_000,
    maxInvocationsPerIsolate: opts.poolConfig?.maxInvocationsPerIsolate ?? 1000,
    crashLoopThreshold: opts.poolConfig?.crashLoopThreshold ?? 3,
    crashLoopWindowMs: opts.poolConfig?.crashLoopWindowMs ?? 60_000,
    runQueryProxy: async () => [],
    onLog: () => {},
    loadProjectEnv: async () => ({}),
    denoPath,
  });

  const bundleA: Bundle = {
    projectId: 'p-int',
    deploymentId: opts.first.deploymentId,
    functionNames: [opts.first.fnName],
    directory: bundleDirA,
  };
  const requestA: InvokeRequest = {
    projectId: 'p-int',
    functionName: opts.first.fnName,
    args: {},
    deploymentId: opts.first.deploymentId,
    requestId: `req-${Date.now()}-a`,
    auth: null,
  };
  const first = await pool.invoke(bundleA, requestA);

  const bundleB: Bundle = {
    projectId: 'p-int',
    deploymentId: opts.second.deploymentId,
    functionNames: [opts.second.fnName],
    directory: bundleDirB,
  };
  const requestB: InvokeRequest = {
    projectId: 'p-int',
    functionName: opts.second.fnName,
    args: {},
    deploymentId: opts.second.deploymentId,
    requestId: `req-${Date.now()}-b`,
    auth: null,
  };
  const second = await pool.invoke(bundleB, requestB);

  const cleanup = async () => {
    await pool.shutdown();
    await rm(workDir, { recursive: true, force: true });
  };
  return { first, second, pidsObserved, cleanup };
}

export interface RepeatedFixtureOpts {
  fnName: string;
  fnSource: string;
  deploymentId: string;
  count: number;
  poolConfig?: FixtureOpts['poolConfig'];
}

export interface RepeatedFixtureResult {
  results: InvokeResult[];
  cleanup: () => Promise<void>;
}

/**
 * Run `count` sequential invocations against the same pool, projectId,
 * deploymentId, and bundle. Used by the crash-loop breaker test so the
 * breaker history accumulates across all calls.
 */
export async function runFixtureRepeated(
  opts: RepeatedFixtureOpts,
): Promise<RepeatedFixtureResult> {
  const workDir = await mkdtemp(join(tmpdir(), 'briven-int-'));
  const bundleDir = join(workDir, 'bundle');
  const isolateBase = join(workDir, 'isolates');
  const runtimeStubDir = join(workDir, 'stub');
  await vendorRuntimeStubs(runtimeStubDir);

  await mkdir(join(bundleDir, 'functions'), { recursive: true });
  await writeFile(join(bundleDir, 'functions', `${opts.fnName}.ts`), opts.fnSource);
  await mkdir(isolateBase, { recursive: true });

  const denoPath = resolveDenoPath();
  const spawn = makeBunChildSpawn(denoPath);

  const pool = new IsolatePoolImpl({
    spawn,
    runtimeStubDir,
    isolateBaseDir: isolateBase,
    maxIsolates: opts.poolConfig?.maxIsolates ?? 50,
    maxMemoryMb: opts.poolConfig?.maxMemoryMb ?? 128,
    invocationTimeoutMs: opts.poolConfig?.invocationTimeoutMs ?? 30_000,
    idleKillMs: opts.poolConfig?.idleKillMs ?? 10 * 60_000,
    maxInvocationsPerIsolate: opts.poolConfig?.maxInvocationsPerIsolate ?? 1000,
    crashLoopThreshold: opts.poolConfig?.crashLoopThreshold ?? 3,
    crashLoopWindowMs: opts.poolConfig?.crashLoopWindowMs ?? 60_000,
    runQueryProxy: async () => [],
    onLog: () => {},
    loadProjectEnv: async () => ({}),
    denoPath,
  });

  const bundle: Bundle = {
    projectId: 'p-int',
    deploymentId: opts.deploymentId,
    functionNames: [opts.fnName],
    directory: bundleDir,
  };

  const results: InvokeResult[] = [];
  for (let i = 0; i < opts.count; i++) {
    const request: InvokeRequest = {
      projectId: 'p-int',
      functionName: opts.fnName,
      args: {},
      deploymentId: opts.deploymentId,
      requestId: `req-${Date.now()}-${i}`,
      auth: null,
    };
    results.push(await pool.invoke(bundle, request));
  }

  const cleanup = async () => {
    await pool.shutdown();
    await rm(workDir, { recursive: true, force: true });
  };
  return { results, cleanup };
}

export interface IdleKillFixtureOpts {
  fnSource: string;
  fnName: string;
  deploymentId: string;
  /** Idle threshold in ms; the helper waits 2x this between invokes before triggering the sweeper. */
  idleKillMs: number;
}

export interface IdleKillFixtureResult {
  firstPid: number;
  secondPid: number;
  cleanup: () => Promise<void>;
}

/**
 * Two sequential invocations against the same pool with the idle sweeper
 * triggered between them, proving the first isolate gets retired and the
 * second invocation cold-starts a fresh process.
 */
export async function runIdleKillFixture(
  opts: IdleKillFixtureOpts,
): Promise<IdleKillFixtureResult> {
  const workDir = await mkdtemp(join(tmpdir(), 'briven-int-'));
  const bundleDir = join(workDir, 'bundle');
  const isolateBase = join(workDir, 'isolates');
  const runtimeStubDir = join(workDir, 'stub');
  await vendorRuntimeStubs(runtimeStubDir);

  await mkdir(join(bundleDir, 'functions'), { recursive: true });
  await writeFile(join(bundleDir, 'functions', `${opts.fnName}.ts`), opts.fnSource);
  await mkdir(isolateBase, { recursive: true });

  const denoPath = resolveDenoPath();
  const pidsObserved: number[] = [];
  const spawn = withPidRecorder(makeBunChildSpawn(denoPath), pidsObserved);

  const pool = new IsolatePoolImpl({
    spawn,
    runtimeStubDir,
    isolateBaseDir: isolateBase,
    maxIsolates: 50,
    maxMemoryMb: 128,
    invocationTimeoutMs: 30_000,
    idleKillMs: opts.idleKillMs,
    maxInvocationsPerIsolate: 1000,
    crashLoopThreshold: 3,
    crashLoopWindowMs: 60_000,
    runQueryProxy: async () => [],
    onLog: () => {},
    loadProjectEnv: async () => ({}),
    denoPath,
  });

  const bundle: Bundle = {
    projectId: 'p-int',
    deploymentId: opts.deploymentId,
    functionNames: [opts.fnName],
    directory: bundleDir,
  };
  const makeRequest = (suffix: string): InvokeRequest => ({
    projectId: 'p-int',
    functionName: opts.fnName,
    args: {},
    deploymentId: opts.deploymentId,
    requestId: `req-${Date.now()}-${suffix}`,
    auth: null,
  });

  const first = await pool.invoke(bundle, makeRequest('a'));
  if (!first.ok) {
    await pool.shutdown();
    await rm(workDir, { recursive: true, force: true });
    throw new Error(
      `idle-kill helper: first invoke failed with code=${first.code} message=${first.message}`,
    );
  }
  const firstPid = pidsObserved[0] ?? -1;

  // Wait long enough that the entry's lastActivityAt is older than idleKillMs.
  await new Promise((r) => setTimeout(r, Math.max(opts.idleKillMs * 2, 50)));
  await pool.triggerIdleCheck();

  const second = await pool.invoke(bundle, makeRequest('b'));
  if (!second.ok) {
    await pool.shutdown();
    await rm(workDir, { recursive: true, force: true });
    throw new Error(
      `idle-kill helper: second invoke failed with code=${second.code} message=${second.message}`,
    );
  }
  const secondPid = pidsObserved[1] ?? -1;

  const cleanup = async () => {
    await pool.shutdown();
    await rm(workDir, { recursive: true, force: true });
  };
  return { firstPid, secondPid, cleanup };
}

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
