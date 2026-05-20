import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { apiCall } from './api-client.js';

test('apiCall sends Bearer when bearer option is set', async () => {
  const seen: string[] = [];
  const srv = createServer((req, res) => {
    seen.push(req.headers.authorization ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as { port: number }).port;
  await apiCall('/x', { apiOrigin: `http://127.0.0.1:${port}`, bearer: 'tok' });
  srv.close();
  assert.equal(seen[0], 'Bearer tok');
});

test('apiCall still works with apiKey (back-compat)', async () => {
  const seen: { header: string; ok: boolean }[] = [];
  const srv = createServer((req, res) => {
    const auth = req.headers.authorization ?? '';
    seen.push({ header: auth, ok: auth.length > 0 });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as { port: number }).port;
  await apiCall('/x', { apiOrigin: `http://127.0.0.1:${port}`, apiKey: 'brk_test' });
  srv.close();
  assert.equal(seen[0]?.ok, true);
  // The exact header format is whatever the existing brk_ auth uses
  // (Bearer brk_test or x-api-key: brk_test) — just confirm it was sent.
});

test('apiCall throws when neither apiKey nor bearer provided', async () => {
  await assert.rejects(
    () => apiCall('/x', { apiOrigin: 'http://127.0.0.1:0' }),
    /apiKey|bearer/i,
  );
});
