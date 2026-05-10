import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLogger } from './logger.js';

interface CapturedLine {
  channel: 'stdout' | 'stderr';
  line: Record<string, unknown>;
}

function captureWrites(fn: () => void): CapturedLine[] {
  const captured: CapturedLine[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    if (typeof chunk === 'string') {
      captured.push({ channel: 'stdout', line: JSON.parse(chunk) });
    }
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    if (typeof chunk === 'string') {
      captured.push({ channel: 'stderr', line: JSON.parse(chunk) });
    }
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
  return captured;
}

test('emits structured JSON with service + env + level + msg + ts', () => {
  const log = createLogger({ service: 'api', env: 'test', level: 'debug' });
  const lines = captureWrites(() => log.info('boot complete'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.channel, 'stdout');
  const line = lines[0]!.line;
  assert.equal(line.level, 'info');
  assert.equal(line.msg, 'boot complete');
  assert.equal(line.service, 'api');
  assert.equal(line.env, 'test');
  assert.equal(typeof line.ts, 'string');
});

test('warn + error go to stderr; info + debug go to stdout', () => {
  const log = createLogger({ service: 'api', env: 'test', level: 'debug' });
  const lines = captureWrites(() => {
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
  });
  assert.deepEqual(
    lines.map((l) => [l.channel, (l.line as { level: string }).level]),
    [
      ['stdout', 'debug'],
      ['stdout', 'info'],
      ['stderr', 'warn'],
      ['stderr', 'error'],
    ],
  );
});

test('respects min level — debug suppressed when level is info', () => {
  const log = createLogger({ service: 'api', env: 'test', level: 'info' });
  const lines = captureWrites(() => {
    log.debug('d');
    log.info('i');
  });
  assert.equal(lines.length, 1);
  assert.equal((lines[0]!.line as { msg: string }).msg, 'i');
});

test('redacts emails in msg and field strings', () => {
  const log = createLogger({ service: 'api', env: 'test', level: 'debug' });
  const lines = captureWrites(() =>
    log.info('login from user@example.com', { last: 'j@example.com' }),
  );
  const line = lines[0]!.line as { msg: string; last: string };
  assert.equal(line.msg, 'login from [REDACTED:email]');
  assert.equal(line.last, '[REDACTED:email]');
});

test('redacts IPv4 addresses in nested fields', () => {
  const log = createLogger({ service: 'api', env: 'test', level: 'debug' });
  const lines = captureWrites(() =>
    log.warn('peer event', {
      peers: [{ note: 'connected from 10.0.0.1' }, { note: 'ok' }],
      meta: { remote: '192.168.1.5' },
    }),
  );
  const line = lines[0]!.line as {
    peers: { note: string }[];
    meta: { remote: string };
  };
  assert.equal(line.peers[0]!.note, 'connected from [REDACTED:ip]');
  assert.equal(line.peers[1]!.note, 'ok');
  assert.equal(line.meta.remote, '[REDACTED:ip]');
});

test('passes non-string scalars through unchanged', () => {
  const log = createLogger({ service: 'api', env: 'test', level: 'debug' });
  const lines = captureWrites(() =>
    log.info('counts', { n: 42, ok: true, missing: null }),
  );
  const line = lines[0]!.line as { n: number; ok: boolean; missing: unknown };
  assert.equal(line.n, 42);
  assert.equal(line.ok, true);
  assert.equal(line.missing, null);
});

test('caps redaction depth at 16 to refuse pathological input', () => {
  const log = createLogger({ service: 'api', env: 'test', level: 'debug' });
  // Build a deeply nested object beyond the cap.
  let deep: Record<string, unknown> = { leaf: 'user@example.com' };
  for (let i = 0; i < 20; i++) deep = { next: deep };
  const lines = captureWrites(() => log.info('deep', deep));
  // Should not throw; deep inner values become the sentinel rather than
  // recursing further. We don't assert the exact tree shape — just that
  // the logger emitted exactly one line.
  assert.equal(lines.length, 1);
});
