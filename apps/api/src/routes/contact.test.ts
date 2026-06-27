/**
 * Validation-contract tests for the public POST /v1/contact route.
 * Exercises the exported `contactSchema` (the pure, testable seam) so
 * the accept/reject matrix is pinned without standing up postgres /
 * redis. The handler itself (rate-limit + insert) depends on infra and
 * is covered by integration runs.
 */

import { describe, expect, test } from 'bun:test';

import { contactSchema } from './contact.js';

const valid = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  topic: 'support',
  message: 'I have a question about the dashboard.',
};

describe('contactSchema', () => {
  test('accepts a well-formed submission', () => {
    const r = contactSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  test('accepts every allowed topic', () => {
    for (const topic of ['general', 'support', 'sales', 'security', 'privacy', 'other']) {
      expect(contactSchema.safeParse({ ...valid, topic }).success).toBe(true);
    }
  });

  test('rejects an unknown topic', () => {
    expect(contactSchema.safeParse({ ...valid, topic: 'partnerships' }).success).toBe(false);
  });

  test('rejects a missing / empty name', () => {
    expect(contactSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  test('rejects an invalid email', () => {
    expect(contactSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  test('rejects an empty message', () => {
    expect(contactSchema.safeParse({ ...valid, message: '' }).success).toBe(false);
  });

  test('rejects an over-long message (>8000)', () => {
    expect(contactSchema.safeParse({ ...valid, message: 'x'.repeat(8001) }).success).toBe(false);
  });

  test('accepts an optional subject + country', () => {
    const r = contactSchema.safeParse({
      ...valid,
      subject: 'dashboard question',
      country: 'United States',
    });
    expect(r.success).toBe(true);
  });

  test('accepts a submission with neither subject nor country', () => {
    expect(contactSchema.safeParse(valid).success).toBe(true);
  });

  test('rejects an over-long subject (>200)', () => {
    expect(contactSchema.safeParse({ ...valid, subject: 'x'.repeat(201) }).success).toBe(false);
  });

  test('rejects an over-long country (>100)', () => {
    expect(contactSchema.safeParse({ ...valid, country: 'x'.repeat(101) }).success).toBe(false);
  });

  test('rejects a non-object body', () => {
    expect(contactSchema.safeParse(null).success).toBe(false);
    expect(contactSchema.safeParse('nope').success).toBe(false);
  });
});
