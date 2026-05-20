import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { handleCallback, generateState, isLoopback } from './oauth.js';

test('generateState yields 64-hex chars', () => {
  const s = generateState();
  assert.match(s, /^[a-f0-9]{64}$/);
});

test('isLoopback accepts 127.0.0.1 + localhost only', () => {
  assert.equal(isLoopback('http://127.0.0.1:8080/cb'), true);
  assert.equal(isLoopback('http://localhost:8080/cb'), true);
  assert.equal(isLoopback('http://example.com/cb'), false);
  assert.equal(isLoopback('https://127.0.0.1:8080/cb'), false);
});

test('handleCallback rejects state mismatch', () => {
  const req = new Request('http://127.0.0.1/cb?token=t&state=B');
  const r = handleCallback(req, 'A');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /state/);
});

test('handleCallback accepts matching state', () => {
  const req = new Request('http://127.0.0.1/cb?token=tk&state=AA');
  const r = handleCallback(req, 'AA');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.token, 'tk');
});

test('handleCallback honors denied=1', () => {
  const req = new Request('http://127.0.0.1/cb?denied=1&state=AA');
  const r = handleCallback(req, 'AA');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /denied/);
});
