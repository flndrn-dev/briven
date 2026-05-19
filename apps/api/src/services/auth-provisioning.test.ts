import { describe, expect, test } from 'bun:test';

import { AUTH_TABLES, renderAuthProvisioningSql } from './auth-provisioning.js';

describe('auth-provisioning — DDL emitter (BUILD_PLAN.md §3)', () => {
  const stmts = renderAuthProvisioningSql();

  test('emits citext extension first (required before email column types)', () => {
    expect(stmts[0]).toBe('CREATE EXTENSION IF NOT EXISTS citext');
  });

  test('emits all five _briven_auth_* tables with IF NOT EXISTS', () => {
    for (const table of AUTH_TABLES) {
      const hasCreateTable = stmts.some((s) =>
        s.startsWith(`CREATE TABLE IF NOT EXISTS "${table}"`),
      );
      expect(hasCreateTable).toBe(true);
    }
  });

  test('every CREATE INDEX uses IF NOT EXISTS (idempotency)', () => {
    const indexStmts = stmts.filter((s) => s.includes('CREATE') && s.includes('INDEX'));
    expect(indexStmts.length).toBeGreaterThan(0);
    for (const s of indexStmts) {
      expect(s).toContain('IF NOT EXISTS');
    }
  });

  test('users.email is citext for case-insensitive comparison', () => {
    const usersTable = stmts.find((s) =>
      s.startsWith(`CREATE TABLE IF NOT EXISTS "_briven_auth_users"`),
    );
    expect(usersTable).toBeDefined();
    expect(usersTable!).toContain('email citext NOT NULL');
  });

  test('users.email has unique index (one email per tenant)', () => {
    const uniq = stmts.find(
      (s) => s.includes('_briven_auth_users_email_uniq') && s.includes('UNIQUE'),
    );
    expect(uniq).toBeDefined();
  });

  test('sessions cascade-delete on user removal', () => {
    const sessions = stmts.find((s) =>
      s.startsWith(`CREATE TABLE IF NOT EXISTS "_briven_auth_sessions"`),
    );
    expect(sessions).toBeDefined();
    expect(sessions!).toContain('REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE');
  });

  test('accounts cascade-delete on user removal', () => {
    const accounts = stmts.find((s) =>
      s.startsWith(`CREATE TABLE IF NOT EXISTS "_briven_auth_accounts"`),
    );
    expect(accounts!).toContain('REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE');
  });

  test('audit_log preserves rows when user is deleted (forensic value)', () => {
    const audit = stmts.find((s) =>
      s.startsWith(`CREATE TABLE IF NOT EXISTS "_briven_auth_audit_log"`),
    );
    expect(audit!).toContain('REFERENCES "_briven_auth_users"(id) ON DELETE SET NULL');
  });

  test('accounts has the (provider_id, provider_account_id) uniqueness constraint', () => {
    const uniq = stmts.find(
      (s) =>
        s.includes('_briven_auth_accounts_provider_pair_uniq') &&
        s.includes('UNIQUE') &&
        s.includes('(provider_id, provider_account_id)'),
    );
    expect(uniq).toBeDefined();
  });

  test('verification_tokens stores value_hash, never the raw token', () => {
    const verif = stmts.find((s) =>
      s.startsWith(`CREATE TABLE IF NOT EXISTS "_briven_auth_verification_tokens"`),
    );
    expect(verif!).toContain('value_hash text NOT NULL');
    // Negative check: there must not be a raw `value` column.
    expect(verif!).not.toMatch(/\bvalue text\b/);
  });

  test('audit_log metadata defaults to empty jsonb', () => {
    const audit = stmts.find((s) =>
      s.startsWith(`CREATE TABLE IF NOT EXISTS "_briven_auth_audit_log"`),
    );
    expect(audit!).toContain(`metadata jsonb NOT NULL DEFAULT '{}'::jsonb`);
  });

  test('AUTH_TABLES is exhaustive and length matches DDL emit', () => {
    expect(AUTH_TABLES.length).toBe(5);
    const createdTables = stmts
      .filter((s) => s.startsWith('CREATE TABLE'))
      .map((s) => s.match(/"(_briven_auth_[a-z_]+)"/)?.[1]);
    expect(new Set(createdTables)).toEqual(new Set(AUTH_TABLES));
  });

  test('all statements are single-line (whitespace normalised)', () => {
    for (const s of stmts) {
      expect(s).not.toContain('\n');
      expect(s.length).toBeGreaterThan(0);
    }
  });
});
