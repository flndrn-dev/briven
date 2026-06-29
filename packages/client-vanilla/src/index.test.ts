import { afterEach, describe, expect, test } from 'bun:test';

import { createBrivenClient } from './index.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function client() {
  return createBrivenClient({ projectId: 'p_test', apiOrigin: 'https://api.test' });
}

describe('invoke() never throws — always returns an InvokeFrame', () => {
  test('non-JSON gateway body (502 HTML) → network_error frame, not a SyntaxError', async () => {
    globalThis.fetch = (async () =>
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;

    const frame = await client().invoke('listNotes');
    expect(frame.ok).toBe(false);
    if (!frame.ok) {
      expect(frame.code).toBe('network_error');
      expect(typeof frame.message).toBe('string');
      expect(frame.durationMs).toBe(0);
    }
  });

  test('a valid JSON error frame (422) is returned as-is', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, code: 'validation_failed', message: 'bad', durationMs: 3 }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    const frame = await client().invoke('createTodo', {});
    expect(frame.ok).toBe(false);
    if (!frame.ok) {
      expect(frame.code).toBe('validation_failed');
      expect(frame.message).toBe('bad');
    }
  });

  test('a network failure (fetch throws) → network_error frame', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const frame = await client().invoke('listNotes');
    expect(frame.ok).toBe(false);
    if (!frame.ok) expect(frame.code).toBe('network_error');
  });

  test('a valid success frame passes through', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, value: [1, 2, 3], durationMs: 5 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    const frame = await client().invoke('listNotes');
    expect(frame.ok).toBe(true);
    if (frame.ok) expect(frame.value).toEqual([1, 2, 3]);
  });
});
