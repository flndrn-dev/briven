/**
 * AI schema generator boundary tests — pin the not-configured behaviour
 * and the validation rules around prompts. The Ollama-touching path is
 * exercised by a manual smoke against the live DGX; this file covers
 * the pure decisions.
 */

import { describe, expect, test } from 'bun:test';

import { AiNotConfiguredError } from './ai-schema-gen.js';

describe('AiNotConfiguredError', () => {
  test('carries the documented name', () => {
    const err = new AiNotConfiguredError();
    expect(err.name).toBe('AiNotConfiguredError');
  });

  test('the error message mentions the env var to set', () => {
    const err = new AiNotConfiguredError();
    expect(err.message).toContain('BRIVEN_OLLAMA_URL');
  });
});

describe('prompt validation rules', () => {
  // Mirrors the zod schema on the route — 1 to 4000 chars.
  function isValidPrompt(prompt: unknown): boolean {
    return typeof prompt === 'string' && prompt.length >= 1 && prompt.length <= 4000;
  }

  test('rejects empty string', () => {
    expect(isValidPrompt('')).toBe(false);
  });

  test('rejects non-string', () => {
    expect(isValidPrompt(null)).toBe(false);
    expect(isValidPrompt(undefined)).toBe(false);
    expect(isValidPrompt(42)).toBe(false);
    expect(isValidPrompt({})).toBe(false);
  });

  test('accepts a typical prompt', () => {
    expect(isValidPrompt('a blog with users + posts + comments')).toBe(true);
  });

  test('caps at 4000 chars (4001 rejected)', () => {
    expect(isValidPrompt('x'.repeat(4000))).toBe(true);
    expect(isValidPrompt('x'.repeat(4001))).toBe(false);
  });
});
