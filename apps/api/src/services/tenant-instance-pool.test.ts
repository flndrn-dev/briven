import { describe, expect, test } from 'bun:test';

import { TenantInstancePool } from './tenant-instance-pool.js';

interface FakeEngine {
  id: string;
  created: number;
}

function makeFactory() {
  let calls = 0;
  const factory = async (projectId: string): Promise<FakeEngine> => {
    calls += 1;
    return { id: projectId, created: Date.now() };
  };
  return { factory, callCount: () => calls };
}

describe('TenantInstancePool — Layer 2 primitive (ARCHITECTURE.md §3)', () => {
  test('cache miss creates via factory; second get returns the same instance', async () => {
    const { factory, callCount } = makeFactory();
    const pool = new TenantInstancePool<FakeEngine>({
      maxSize: 4,
      idleTtlMs: 60_000,
      factory,
    });
    const a = await pool.get('p_alpha');
    const b = await pool.get('p_alpha');
    expect(a).toBe(b);
    expect(callCount()).toBe(1);
    expect(pool.size).toBe(1);
  });

  test('different projectIds get different instances', async () => {
    const { factory } = makeFactory();
    const pool = new TenantInstancePool<FakeEngine>({
      maxSize: 4,
      idleTtlMs: 60_000,
      factory,
    });
    const a = await pool.get('p_alpha');
    const b = await pool.get('p_bravo');
    expect(a).not.toBe(b);
    expect(a.id).toBe('p_alpha');
    expect(b.id).toBe('p_bravo');
    expect(pool.size).toBe(2);
  });

  test('LRU eviction kicks in at maxSize', async () => {
    const evicted: string[] = [];
    const { factory } = makeFactory();
    const pool = new TenantInstancePool<FakeEngine>({
      maxSize: 2,
      idleTtlMs: 60_000,
      factory,
      onEvict: (projectId) => {
        evicted.push(projectId);
      },
    });
    await pool.get('p_a'); // [p_a]
    await pool.get('p_b'); // [p_a, p_b]
    await pool.get('p_c'); // evicts p_a → [p_b, p_c]
    expect(evicted).toEqual(['p_a']);
    expect(pool.size).toBe(2);
    expect(pool.has('p_a')).toBe(false);
    expect(pool.has('p_b')).toBe(true);
    expect(pool.has('p_c')).toBe(true);
  });

  test('LRU touch moves the entry to the tail (most recently used)', async () => {
    const evicted: string[] = [];
    const { factory } = makeFactory();
    const pool = new TenantInstancePool<FakeEngine>({
      maxSize: 2,
      idleTtlMs: 60_000,
      factory,
      onEvict: (projectId) => {
        evicted.push(projectId);
      },
    });
    await pool.get('p_a'); // [p_a]
    await pool.get('p_b'); // [p_a, p_b]
    await pool.get('p_a'); // touch a → [p_b, p_a]
    await pool.get('p_c'); // evicts p_b → [p_a, p_c]
    expect(evicted).toEqual(['p_b']);
    expect(pool.has('p_a')).toBe(true);
    expect(pool.has('p_c')).toBe(true);
  });

  test('idle TTL eviction: stale entries are dropped on next get', async () => {
    const evicted: string[] = [];
    let factoryCalls = 0;
    const pool = new TenantInstancePool<FakeEngine>({
      maxSize: 4,
      idleTtlMs: 10, // 10ms
      factory: async (projectId) => {
        factoryCalls += 1;
        return { id: projectId, created: Date.now() };
      },
      onEvict: (projectId) => {
        evicted.push(projectId);
      },
    });
    const first = await pool.get('p_alpha');
    await new Promise((r) => setTimeout(r, 20));
    const second = await pool.get('p_alpha');
    expect(second).not.toBe(first); // fresh instance after TTL
    expect(factoryCalls).toBe(2);
    expect(evicted).toEqual(['p_alpha']); // the stale one was evicted
  });

  test('force-evict drops the entry and fires onEvict', async () => {
    const evicted: string[] = [];
    const { factory } = makeFactory();
    const pool = new TenantInstancePool<FakeEngine>({
      maxSize: 4,
      idleTtlMs: 60_000,
      factory,
      onEvict: (projectId) => {
        evicted.push(projectId);
      },
    });
    await pool.get('p_alpha');
    await pool.evict('p_alpha');
    expect(pool.size).toBe(0);
    expect(evicted).toEqual(['p_alpha']);
    // force-evict of unknown is a no-op:
    await pool.evict('p_does_not_exist');
    expect(evicted).toEqual(['p_alpha']);
  });

  test('clear() evicts every entry', async () => {
    const evicted: string[] = [];
    const { factory } = makeFactory();
    const pool = new TenantInstancePool<FakeEngine>({
      maxSize: 4,
      idleTtlMs: 60_000,
      factory,
      onEvict: (projectId) => {
        evicted.push(projectId);
      },
    });
    await pool.get('p_a');
    await pool.get('p_b');
    await pool.get('p_c');
    await pool.clear();
    expect(pool.size).toBe(0);
    expect(evicted.sort()).toEqual(['p_a', 'p_b', 'p_c']);
  });

  test('concurrent gets on same projectId share a single factory invocation', async () => {
    let factoryCalls = 0;
    const pool = new TenantInstancePool<FakeEngine>({
      maxSize: 4,
      idleTtlMs: 60_000,
      factory: async (projectId) => {
        factoryCalls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return { id: projectId, created: Date.now() };
      },
    });
    const [a, b, c] = await Promise.all([
      pool.get('p_alpha'),
      pool.get('p_alpha'),
      pool.get('p_alpha'),
    ]);
    expect(factoryCalls).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test('factory rejection clears the in-flight entry (next get can retry)', async () => {
    let attempts = 0;
    const pool = new TenantInstancePool<FakeEngine>({
      maxSize: 4,
      idleTtlMs: 60_000,
      factory: async (projectId) => {
        attempts += 1;
        if (attempts === 1) throw new Error('boom');
        return { id: projectId, created: Date.now() };
      },
    });
    await expect(pool.get('p_alpha')).rejects.toThrow('boom');
    const inst = await pool.get('p_alpha');
    expect(inst.id).toBe('p_alpha');
    expect(attempts).toBe(2);
  });

  test('onEvictError swallows hook errors so they do not poison the caller', async () => {
    const seen: Array<{ id: string; message: string }> = [];
    const { factory } = makeFactory();
    const pool = new TenantInstancePool<FakeEngine>({
      maxSize: 1,
      idleTtlMs: 60_000,
      factory,
      onEvict: () => {
        throw new Error('teardown failed');
      },
      onEvictError: (projectId, err) => {
        seen.push({ id: projectId, message: err instanceof Error ? err.message : String(err) });
      },
    });
    await pool.get('p_a');
    await pool.get('p_b'); // evicts p_a; hook throws; pool keeps going
    expect(seen.length).toBe(1);
    expect(seen[0]).toEqual({ id: 'p_a', message: 'teardown failed' });
    expect(pool.has('p_b')).toBe(true);
  });

  test('constructor rejects invalid options', () => {
    const { factory } = makeFactory();
    expect(
      () => new TenantInstancePool<FakeEngine>({ maxSize: 0, idleTtlMs: 1000, factory }),
    ).toThrow();
    expect(
      () => new TenantInstancePool<FakeEngine>({ maxSize: 1, idleTtlMs: 0, factory }),
    ).toThrow();
  });
});
