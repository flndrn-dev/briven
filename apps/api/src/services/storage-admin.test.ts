import { describe, expect, test } from 'bun:test';

import { evaluateStorageLimit } from './storage-admin.js';

describe('evaluateStorageLimit (Sprint 4 over-limit flag math)', () => {
  test('under both caps → not over', () => {
    expect(evaluateStorageLimit({ rowCount: 10, tableCount: 2, maxRows: 100, maxTables: 50 })).toEqual({
      overRows: false,
      overTables: false,
      overLimit: false,
    });
  });

  test('exactly at the cap is NOT over (strictly greater than)', () => {
    expect(
      evaluateStorageLimit({ rowCount: 100, tableCount: 50, maxRows: 100, maxTables: 50 }),
    ).toEqual({ overRows: false, overTables: false, overLimit: false });
  });

  test('one over the row cap → overRows + overLimit', () => {
    expect(
      evaluateStorageLimit({ rowCount: 101, tableCount: 2, maxRows: 100, maxTables: 50 }),
    ).toEqual({ overRows: true, overTables: false, overLimit: true });
  });

  test('over the table cap only → overTables + overLimit', () => {
    expect(
      evaluateStorageLimit({ rowCount: 10, tableCount: 51, maxRows: 100, maxTables: 50 }),
    ).toEqual({ overRows: false, overTables: true, overLimit: true });
  });
});
