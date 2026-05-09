import assert from 'node:assert/strict';
import { test } from 'node:test';

import { containsForbiddenContent, redactValue } from './redaction.js';

test('containsForbiddenContent flags emails', () => {
  assert.equal(containsForbiddenContent('user@example.com'), true);
  assert.equal(containsForbiddenContent('contact j.flandriendev@hotmail.com today'), true);
});

test('containsForbiddenContent flags IPv4 addresses', () => {
  assert.equal(containsForbiddenContent('client at 192.168.1.5 logged in'), true);
  assert.equal(containsForbiddenContent('peer 10.0.0.1'), true);
});

test('containsForbiddenContent allows harmless content', () => {
  assert.equal(containsForbiddenContent('deploy succeeded'), false);
  assert.equal(containsForbiddenContent('user_id=u_abc123'), false);
});

test('redactValue replaces emails with [REDACTED:email]', () => {
  assert.equal(redactValue('contact user@example.com'), 'contact [REDACTED:email]');
});

test('redactValue replaces IPv4 with [REDACTED:ip]', () => {
  assert.equal(redactValue('peer 10.0.0.1 connected'), 'peer [REDACTED:ip] connected');
});

test('redactValue leaves harmless strings unchanged', () => {
  assert.equal(redactValue('hello world'), 'hello world');
});

test('redactValue passes non-string values through unchanged', () => {
  assert.equal(redactValue(42), 42);
  assert.equal(redactValue(null), null);
  assert.deepEqual(redactValue({ key: 'value' }), { key: 'value' });
});
