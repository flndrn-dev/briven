import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeMe } from './platform.js';

describe('normalizeMe', () => {
  it('accepts flat /v1/me profile', () => {
    assert.deepEqual(normalizeMe({ id: 'u_1', email: 'a@b.co', name: 'A' }), {
      id: 'u_1',
      email: 'a@b.co',
    });
  });

  it('accepts nested { user } shape', () => {
    assert.deepEqual(normalizeMe({ user: { id: 'u_2', email: 'c@d.co' } }), {
      id: 'u_2',
      email: 'c@d.co',
    });
  });

  it('throws on garbage', () => {
    assert.throws(() => normalizeMe({}), /unexpected/);
    assert.throws(() => normalizeMe(null), /unexpected/);
  });
});
