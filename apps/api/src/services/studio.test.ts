import { describe, expect, test } from 'bun:test';

import { ValidationError } from '@briven/shared';

import { buildFilterClauses, FILTER_OPS } from './studio.js';

const COLS = new Set(['id', 'name', 'created_at', 'score']);

describe('buildFilterClauses — Phase 2 §2.3 verify', () => {
  test('eq renders parameterised equality and keeps value in params', () => {
    const { clauses, params } = buildFilterClauses(
      [{ column: 'name', op: 'eq', value: 'alice' }],
      COLS,
      'users',
    );
    expect(clauses).toEqual(['"name" = $1']);
    expect(params).toEqual(['alice']);
  });

  test('contains renders ILIKE with %|| placeholder ||% — no client pattern smuggling', () => {
    const { clauses, params } = buildFilterClauses(
      [{ column: 'name', op: 'contains', value: '%admin%' }],
      COLS,
      'users',
    );
    // The literal %s in the SQL come from the server template, not the input;
    // the input ('%admin%') lands verbatim as a parameter.
    expect(clauses).toEqual([`"name"::text ILIKE '%' || $1 || '%'`]);
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

  test('multiple filters share a params array with sequential placeholders', () => {
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
      buildFilterClauses(
        [{ column: 'not_a_column', op: 'eq', value: 'x' }],
        COLS,
        'users',
      ),
    ).toThrow(ValidationError);
  });

  test('malformed column name → ValidationError (identifier guard)', () => {
    // The COLUMN_NAME_RE blocks anything that isn't [A-Za-z_][A-Za-z0-9_]* —
    // a SQL-injection attempt at the column slot like `id;--` can't pass.
    expect(() =>
      buildFilterClauses([{ column: 'id;--', op: 'eq', value: 'x' }], COLS, 'users'),
    ).toThrow(ValidationError);
  });

  test('unknown operator → ValidationError (allow-list)', () => {
    expect(() =>
      buildFilterClauses(
        // @ts-expect-error — bypassing the type to simulate a route that
        // failed to pre-validate the op string against FILTER_OPS.
        [{ column: 'name', op: 'regex', value: '.*' }],
        COLS,
        'users',
      ),
    ).toThrow(ValidationError);
  });

  test('SQL-injection in value is harmless — it just lands in params as a string', () => {
    const { clauses, params } = buildFilterClauses(
      [{ column: 'name', op: 'eq', value: "'; DROP TABLE users; --" }],
      COLS,
      'users',
    );
    // The clause itself contains only the placeholder, never the value text.
    expect(clauses[0]).toBe('"name" = $1');
    expect(clauses[0]).not.toContain('DROP');
    // The dangerous string is in params, where postgres treats it as a literal.
    expect(params).toEqual(["'; DROP TABLE users; --"]);
  });

  test('empty filter list → empty clauses + empty params (no WHERE emitted upstream)', () => {
    const { clauses, params } = buildFilterClauses([], COLS, 'users');
    expect(clauses).toEqual([]);
    expect(params).toEqual([]);
  });
});
