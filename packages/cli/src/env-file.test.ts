import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { mergeEnvFile } from './env-file.js';

test('creates a new file with two keys', () => {
  const out = mergeEnvFile('', {
    BRIVEN_DEPLOYMENT: 'p_01XYZ',
    NEXT_PUBLIC_BRIVEN_URL: 'https://api.briven.tech',
  });
  assert.match(out, /BRIVEN_DEPLOYMENT="p_01XYZ"/);
  assert.match(out, /NEXT_PUBLIC_BRIVEN_URL="https:\/\/api\.briven\.tech"/);
});

test('preserves unrelated user-set keys', () => {
  const existing = 'DATABASE_URL=postgres://x\nMY_TOKEN=abc\n';
  const out = mergeEnvFile(existing, { BRIVEN_DEPLOYMENT: 'p_01XYZ' });
  assert.match(out, /DATABASE_URL=postgres:\/\/x/);
  assert.match(out, /MY_TOKEN=abc/);
  assert.match(out, /BRIVEN_DEPLOYMENT="p_01XYZ"/);
});

test('updates an existing BRIVEN_ key in place', () => {
  const existing = 'BRIVEN_DEPLOYMENT="p_OLD"\nOTHER=keep\n';
  const out = mergeEnvFile(existing, { BRIVEN_DEPLOYMENT: 'p_NEW' });
  assert.match(out, /BRIVEN_DEPLOYMENT="p_NEW"/);
  assert.doesNotMatch(out, /p_OLD/);
  assert.match(out, /OTHER=keep/);
});

test('quotes values that contain spaces or special chars', () => {
  const out = mergeEnvFile('', { BRIVEN_FOO: 'a b c' });
  assert.match(out, /BRIVEN_FOO="a b c"/);
});

test('passes malformed lines through untouched', () => {
  const existing = '# a comment\n\nWEIRDLINE no equals\nBRIVEN_X=old\n';
  const out = mergeEnvFile(existing, { BRIVEN_X: 'new' });
  assert.match(out, /# a comment/);
  assert.match(out, /WEIRDLINE no equals/);
  assert.match(out, /BRIVEN_X="new"/);
});
