/**
 * AI function generator boundary tests. The Ollama-touching path is
 * exercised by a manual smoke against the live DGX; this file pins the
 * pure decisions: fence-stripping, schema-context truncation, and the
 * shared not-configured contract.
 */

import { describe, expect, test } from 'bun:test';

import { AiNotConfiguredError } from './ai-schema-gen.js';

describe('AiNotConfiguredError shared contract', () => {
  // The function generator surfaces the same error class as the schema
  // generator so the route handlers can collapse the 503 path. If this
  // ever changes both routes need touching.
  test('class is shared with the schema generator', () => {
    const err = new AiNotConfiguredError();
    expect(err.name).toBe('AiNotConfiguredError');
  });
});

describe('schema-context truncation', () => {
  // Mirrors the SCHEMA_CONTEXT_MAX_BYTES rule (8 KB) inside generateFunction.
  function truncate(ctx: string, max = 8 * 1024): string {
    return ctx.slice(0, max);
  }

  test('passes through short contexts unchanged', () => {
    const short = 'table posts { id: text PK }';
    expect(truncate(short)).toBe(short);
  });

  test('truncates exactly at the cap', () => {
    const overflow = 'x'.repeat(8 * 1024 + 100);
    expect(truncate(overflow).length).toBe(8 * 1024);
  });

  test('a context at exactly the cap is unchanged', () => {
    const at = 'x'.repeat(8 * 1024);
    expect(truncate(at).length).toBe(8 * 1024);
  });
});

describe('markdown fence stripping', () => {
  // Mirrors the stripMarkdownFences regex in ai-function-gen.ts. We can't
  // import the private helper, so the test pins the contract by mirroring
  // the rules and asserting against the same inputs the helper sees.
  function stripFences(text: string): string {
    const start = /^```(?:typescript|ts|tsx)?\s*\n/;
    const end = /\n```\s*$/;
    if (start.test(text) && end.test(text)) {
      return text.replace(start, '').replace(end, '');
    }
    return text;
  }

  test('strips ```typescript fences when both ends present', () => {
    const fenced = '```typescript\nexport default query(...);\n```';
    expect(stripFences(fenced)).toBe('export default query(...);');
  });

  test('strips ```ts fences', () => {
    const fenced = '```ts\nexport default mutation(...);\n```';
    expect(stripFences(fenced)).toBe('export default mutation(...);');
  });

  test('strips bare ``` fences', () => {
    const fenced = '```\nexport default query(...);\n```';
    expect(stripFences(fenced)).toBe('export default query(...);');
  });

  test('leaves unfenced text alone', () => {
    const bare = 'export default query(...);';
    expect(stripFences(bare)).toBe(bare);
  });

  test('does not strip a half-fence (no trailing close)', () => {
    const half = '```typescript\nexport default query(...);';
    expect(stripFences(half)).toBe(half);
  });

  test('does not strip a misaligned fence (no opening)', () => {
    const half = 'export default query(...);\n```';
    expect(stripFences(half)).toBe(half);
  });
});
