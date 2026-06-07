import { describe, expect, test } from 'bun:test';

import { ValidationError } from '@briven/shared';

import { buildFilterClauses, FILTER_OPS } from './studio.js';

const COLS = new Set(['id', 'name', 'created_at', 'score']);

describe('buildFilterClauses — MySQL (Phase 5)', () => {
  test('eq renders parameterised equality with backtick quoting', () => {
    const { clauses, params } = buildFilterClauses(
      [{ column: 'name', op: 'eq', value: 'alice' }],
      COLS,
      'users',
    );
    expect(clauses).toEqual(['`name` = ?']);
    expect(params).toEqual(['alice']);
  });

  test('contains renders LIKE with CONCAT — no client pattern smuggling', () => {
    const { clauses, params } = buildFilterClauses(
      [{ column: 'name', op: 'contains', value: '%admin%' }],
      COLS,
      'users',
    );
    expect(clauses).toEqual(["`name` LIKE CONCAT('%', ?, '%')"]);
    expect(params).toEqual(['%admin%']);
  });

  test.each(FILTER_OPS.filter((op) => op !== 'eq' && op !== 'contains'))(
    'comparison op %s renders the right operator',
    (op) => {
      const { clauses, params } = buildFilterClauses(
        [{ column: 'score', op, value: 42 }],
        COLS,
        'leaderboard',
      );
      const symbol = { gt: '>', lt: '<', gte: '>=', lte: '<=' }[op as 'gt' | 'lt' | 'gte' | 'lte'];
      expect(clauses).toEqual([`\`score\` ${symbol} ?`]);
      expect(params).toEqual([42]);
    },
  );

  test('multiple filters share a params array with positional placeholders', () => {
    const { clauses, params } = buildFilterClauses(
      [
        { column: 'name', op: 'eq', value: 'alice' },
        { column: 'score', op: 'gt', value: 100 },
      ],
      COLS,
      'users',
    );
    expect(clauses).toEqual(['`name` = ?', '`score` > ?']);
    expect(params).toEqual(['alice', 100]);
  });

  test('unknown column → ValidationError (not 500)', () => {
    expect(() =>
      buildFilterClauses(
        [{ column: 'nonexistent', op: 'eq', value: 'x' }],
        COLS,
        'users',
      ),
    ).toThrow(ValidationError);
  });

  test('invalid column name (SQL injection attempt) → ValidationError', () => {
    expect(() =>
      buildFilterClauses(
        [{ column: 'name; DROP TABLE users', op: 'eq', value: 'x' }],
        COLS,
        'users',
      ),
    ).toThrow(ValidationError);
  });

  test('invalid operator → ValidationError', () => {
    expect(() =>
      buildFilterClauses(
        [{ column: 'name', op: 'like' as never, value: 'x' }],
        COLS,
        'users',
      ),
    ).toThrow(ValidationError);
  });

  test('SQL injection value does NOT appear in the clause text', () => {
    const { clauses, params } = buildFilterClauses(
      [{ column: 'name', op: 'eq', value: "'; DROP TABLE users; --" }],
      COLS,
      'users',
    );
    expect(clauses[0]).toBe('`name` = ?');
    expect(clauses[0]).not.toContain('DROP');
    expect(params).toEqual(["'; DROP TABLE users; --"]);
  });
});
