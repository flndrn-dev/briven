import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decideBranch } from './wizard.js';

test('decideBranch: missing briven.json → wizard', () => {
  assert.equal(decideBranch({ hasBrivenJson: false, hasUserToken: true }), 'wizard');
});
test('decideBranch: missing token → auth then watch', () => {
  assert.equal(decideBranch({ hasBrivenJson: true, hasUserToken: false }), 'auth-then-watch');
});
test('decideBranch: both present → watch', () => {
  assert.equal(decideBranch({ hasBrivenJson: true, hasUserToken: true }), 'watch');
});
