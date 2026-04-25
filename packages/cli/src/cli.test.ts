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

  it('returns 0 for "link --help"', async () => {
    const code = await run(['link', '--help']);
    assert.equal(code, 0);
  });

  it('returns 1 for "link" with no briven.json in cwd', async () => {
    // The CLI workspace root has no briven.json (it's a package, not a briven
    // project), so this exercises the "no briven.json" guard end-to-end.
    const code = await run(['link']);
    assert.equal(code, 1);
  });
});
