import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { shouldPromptForDiff } from './dev.js';

test('free tier: never prompts on non-destructive', () => {
  assert.equal(shouldPromptForDiff({ tier: 'free', destructive: false }), false);
});
test('free tier: prompts on destructive', () => {
  assert.equal(shouldPromptForDiff({ tier: 'free', destructive: true }), true);
});
test('pro tier: prompts on every change', () => {
  assert.equal(shouldPromptForDiff({ tier: 'pro', destructive: false }), true);
  assert.equal(shouldPromptForDiff({ tier: 'pro', destructive: true }), true);
});
test('team tier: prompts on every change', () => {
  assert.equal(shouldPromptForDiff({ tier: 'team', destructive: false }), true);
  assert.equal(shouldPromptForDiff({ tier: 'team', destructive: true }), true);
});
