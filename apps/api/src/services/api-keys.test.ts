import { describe, expect, test } from 'bun:test';

import { isAssignableKeyRole } from './api-keys.js';

describe('isAssignableKeyRole', () => {
  test('accepts viewer, developer, admin', () => {
    expect(isAssignableKeyRole('viewer')).toBe(true);
    expect(isAssignableKeyRole('developer')).toBe(true);
    expect(isAssignableKeyRole('admin')).toBe(true);
  });

  test('rejects owner — reserved for human owners', () => {
    expect(isAssignableKeyRole('owner')).toBe(false);
  });

  test('rejects unknown strings', () => {
    expect(isAssignableKeyRole('superadmin')).toBe(false);
    expect(isAssignableKeyRole('')).toBe(false);
    expect(isAssignableKeyRole('VIEWER')).toBe(false);
  });
});
