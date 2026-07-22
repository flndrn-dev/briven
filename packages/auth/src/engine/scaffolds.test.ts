import { describe, expect, test } from 'bun:test';

import { BRIVEN_ENGINE_SCAFFOLDS, listBrivenEngineScaffolds } from './scaffolds.js';

describe('briven-engine scaffolds', () => {
  test('branded engine', () => {
    expect(BRIVEN_ENGINE_SCAFFOLDS.engine).toBe('briven-engine');
  });

  test('lists scaffold keys', () => {
    const keys = listBrivenEngineScaffolds();
    expect(keys).toContain('nextAppRouterProxy');
    expect(keys).toContain('passwordlessSms');
  });

  test('proxy snippet mentions briven-engine', () => {
    expect(BRIVEN_ENGINE_SCAFFOLDS.nextAppRouterProxy).toContain('briven-engine');
  });
});
