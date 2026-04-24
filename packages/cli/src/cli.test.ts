import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { run } from './index.js';

describe('@briven/cli entry', () => {
  it('exports run()', () => {
    assert.equal(typeof run, 'function');
  });

  it('returns 0 for --help', async () => {
    const code = await run(['--help']);
    assert.equal(code, 0);
  });

  it('returns 1 for an unknown command', async () => {
    const code = await run(['definitely-not-a-command']);
    assert.equal(code, 1);
  });
});
