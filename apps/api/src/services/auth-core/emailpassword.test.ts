import { describe, expect, test } from 'bun:test';

import {
  hashPassword,
  verifyPassword,
  verifyPasswordFlexible,
} from './emailpassword.js';

describe('briven-engine password hash (Phase 2)', () => {
  test('hashes and verifies correct password', () => {
    const { hash } = hashPassword('Step2Test!Pass99');
    expect(hash.includes(':')).toBe(true);
    expect(verifyPassword('Step2Test!Pass99', hash)).toBe(true);
  });

  test('rejects wrong password', () => {
    const { hash } = hashPassword('correct-horse');
    expect(verifyPassword('wrong-battery', hash)).toBe(false);
  });

  test('same salt is deterministic', () => {
    const salt = 'a'.repeat(32);
    const a = hashPassword('same', salt);
    const b = hashPassword('same', salt);
    expect(a.hash).toBe(b.hash);
  });

  test('malformed stored hash fails closed', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
  });

  test('import:bcrypt foreign hash verifies and flags upgrade', async () => {
    const raw = await Bun.password.hash('MigrateMe!99', { algorithm: 'bcrypt', cost: 4 });
    const stored = `import:bcrypt:${raw}`;
    expect(verifyPassword('MigrateMe!99', stored)).toBe(false); // sync path rejects foreign
    const ok = await verifyPasswordFlexible('MigrateMe!99', stored);
    expect(ok.ok).toBe(true);
    expect(ok.upgradeToBriven).toBe(true);
    const bad = await verifyPasswordFlexible('wrong', stored);
    expect(bad.ok).toBe(false);
  });
});
