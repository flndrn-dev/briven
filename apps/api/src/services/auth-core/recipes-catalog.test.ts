import { describe, expect, test } from 'bun:test';

import { BRIVEN_ENGINE_RECIPE_CATALOG } from './recipes.js';
import { BRIVEN_ENGINE_SOCIAL_CATALOG } from './providers.js';

describe('briven-engine recipe catalog', () => {
  test('includes SMS passwordless', () => {
    const pl = BRIVEN_ENGINE_RECIPE_CATALOG.find((r) => r.id === 'passwordless');
    expect(pl).toBeDefined();
    expect(pl?.sms).toBe(true);
  });

  test('has session at phase 2', () => {
    const s = BRIVEN_ENGINE_RECIPE_CATALOG.find((r) => r.id === 'session');
    expect(s?.phase).toBe(2);
  });

  test('social catalog is non-empty and branded', () => {
    expect(BRIVEN_ENGINE_SOCIAL_CATALOG.length).toBeGreaterThan(5);
    for (const p of BRIVEN_ENGINE_SOCIAL_CATALOG) {
      expect(p.engine).toBe('briven-engine');
      expect(p.builtIn).toBe(true);
    }
  });
});
