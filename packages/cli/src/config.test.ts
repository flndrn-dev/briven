import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Override XDG_CONFIG_HOME so tests don't pollute the real ~/.config/briven.
let tempDir: string;
test('setup: redirect XDG_CONFIG_HOME to temp dir', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'briven-config-'));
  process.env.XDG_CONFIG_HOME = tempDir;
});

test('user-credential round-trip preserves project entries', async () => {
  const { readCredentials, writeUserCredential, readUserCredential } = await import('./config.js');
  const start = await readCredentials();
  await writeUserCredential({
    token: 't.fake.jwt',
    userId: 'u_round_trip',
    apiOrigin: 'https://api.briven.tech',
    savedAt: new Date().toISOString(),
  });
  const after = await readCredentials();
  assert.equal(after.user?.userId, 'u_round_trip');
  assert.deepEqual(after.projects, start.projects);
  const u = await readUserCredential();
  assert.equal(u?.userId, 'u_round_trip');
});

test('clearUserCredential removes only user block, preserves projects', async () => {
  const { clearUserCredential, readCredentials } = await import('./config.js');
  await clearUserCredential();
  const after = await readCredentials();
  assert.equal(after.user, undefined);
  // projects map should still be present (empty or whatever it was).
  assert.ok('projects' in after);
});

test('teardown: cleanup temp dir', async () => {
  await rm(tempDir, { recursive: true, force: true });
});
