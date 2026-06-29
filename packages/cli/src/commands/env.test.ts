import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, test } from 'node:test';

import { readPipedLine } from './env.js';

describe('readPipedLine (piped, non-TTY stdin)', () => {
  test('resolves the piped value — `echo secret | briven env set KEY`', async () => {
    // Stream ends right after the line, which synchronously triggers the
    // readline "close". Before the fix this rejected "cancelled"; now the
    // value must come through.
    const input = Readable.from(['my-secret-value\n']);
    const value = await readPipedLine(input);
    assert.equal(value, 'my-secret-value');
  });

  test('resolves even when there is no trailing newline before EOF', async () => {
    const input = Readable.from(['no-newline']);
    const value = await readPipedLine(input);
    assert.equal(value, 'no-newline');
  });

  test('rejects "cancelled" only when no line ever arrives (empty stdin)', async () => {
    const input = Readable.from([]);
    await assert.rejects(readPipedLine(input), /cancelled/);
  });
});
