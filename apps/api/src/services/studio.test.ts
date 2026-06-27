import { describe, expect, test } from 'bun:test';

import { ValidationError } from '@briven/shared';

import { buildFilterClauses, FILTER_OPS } from './studio.js';

// NOTE (sprint plan S0.4): this file previously asserted MySQL output
// (backtick quoting + `?` placeholders) while the shipped code emits
// Postgres (`"col"` + `$n`). A test in the wrong dialect can never catch a
// real DoltGres break — it shows green regardless. Rewritten to match the
// actual Postgres/DoltGres SQL `buildFilterClauses` produces.

const COLS = new Set(['id', 'name', 'created_at', 'score']);

describe('buildFilterClauses — Postgres/DoltGres', () => {
  test('eq renders parameterised equality with double-quote identifier + $n', () => {
    const { clauses, params } = buildFilterClauses(
      [{ column: 'name', op: 'eq', value: 'alice' }],
      COLS,
      'users',
    );
    expect(clauses).toEqual(['"name" = $1']);
    expect(params).toEqual(['alice']);
  });

  test('contains renders case-insensitive substring match — no client pattern smuggling', () => {
    const { clauses, params } = buildFilterClauses(
      [{ column: 'name', op: 'contains', value: '%admin%' }],
      COLS,
      'users',
    );
    // The `%` are glued in SQL around the parameter, so a caller writing
    // `%admin%` cannot smuggle pattern characters — the literal value is bound.
    // DoltGres has no ILIKE, so we use lower()+LIKE for case-insensitive match.
    expect(clauses).toEqual([`lower("name"::text) LIKE '%' || lower($1) || '%'`]);
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
      expect(clauses).toEqual([`"score" ${symbol} $1`]);
      expect(params).toEqual([42]);
    },
  );

  test('multiple filters share a params array with incrementing $n placeholders', () => {
    const { clauses, params } = buildFilterClauses(
      [
        { column: 'name', op: 'eq', value: 'alice' },
        { column: 'score', op: 'gt', value: 100 },
      ],
      COLS,
      'users',
    );
    expect(clauses).toEqual(['"name" = $1', '"score" > $2']);
    expect(params).toEqual(['alice', 100]);
  });

  test('unknown column → ValidationError (not 500)', () => {
    expect(() =>
      buildFilterClauses([{ column: 'nonexistent', op: 'eq', value: 'x' }], COLS, 'users'),
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
      buildFilterClauses([{ column: 'name', op: 'like' as never, value: 'x' }], COLS, 'users'),
    ).toThrow(ValidationError);
  });

  test('SQL injection value does NOT appear in the clause text', () => {
    const { clauses, params } = buildFilterClauses(
      [{ column: 'name', op: 'eq', value: "'; DROP TABLE users; --" }],
      COLS,
      'users',
    );
    expect(clauses[0]).toBe('"name" = $1');
    expect(clauses[0]).not.toContain('DROP');
    expect(params).toEqual(["'; DROP TABLE users; --"]);
  });
});
