import { describe, expect, test } from 'bun:test';

import { AUTH_TABLES, renderAuthProvisioningSql } from './auth-provisioning.js';

// NOTE: this file previously asserted MySQL DDL (backtick quoting,
// COLLATE utf8mb4_unicode_ci, JSON_OBJECT()) while the emitter produces
// Postgres/DoltGres DDL — so it never matched reality. Rewritten to assert the
// actual output, and to lock the sprint S2.3 change (no citext / no CREATE
// EXTENSION; email is text with a UNIQUE index on lower(email)).
describe('auth-provisioning — DDL emitter (Postgres/DoltGres)', () => {
  const stmts = renderAuthProvisioningSql();

  test('S2.3: never emits CREATE EXTENSION / citext (unsupported on DoltGres)', () => {
    for (const s of stmts) {
      expect(s).not.toContain('CREATE EXTENSION');
      expect(s).not.toContain('citext');
    }
  });

  test('first statement creates the "_briven_auth_users" table', () => {
    expect(stmts[0]).toContain('CREATE TABLE IF NOT EXISTS "_briven_auth_users"');
  });

  test('emits all six _briven_auth_* tables with IF NOT EXISTS', () => {
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

  test('S2.3: users.email is text with a UNIQUE index on lower(email)', () => {
    const usersTable = stmts.find((s) =>
      s.startsWith('CREATE TABLE IF NOT EXISTS "_briven_auth_users"'),
    );
    expect(usersTable).toBeDefined();
    expect(usersTable!).toContain('email text NOT NULL');
    const uniq = stmts.find(
      (s) =>
        s.includes('_briven_auth_users_email_uniq') &&
        s.includes('UNIQUE') &&
        s.includes('lower(email)'),
    );
    expect(uniq).toBeDefined();
  });

  test('S2.1b: user.email_verified is BOOLEAN (Better-Auth shape, not timestamp)', () => {
    const usersTable = stmts.find((s) =>
      s.startsWith('CREATE TABLE IF NOT EXISTS "_briven_auth_users"'),
    );
    expect(usersTable!).toContain('email_verified boolean NOT NULL DEFAULT false');
  });

  test('S2.1b: accounts has a password column + account_id (Better-Auth credential)', () => {
    const accounts = stmts.find((s) =>
      s.startsWith('CREATE TABLE IF NOT EXISTS "_briven_auth_accounts"'),
    );
    expect(accounts!).toContain('account_id text NOT NULL');
    expect(accounts!).toContain('password text');
  });

  test('sessions cascade-delete on user removal', () => {
    const sessions = stmts.find((s) =>
      s.startsWith('CREATE TABLE IF NOT EXISTS "_briven_auth_sessions"'),
    );
    expect(sessions).toBeDefined();
    expect(sessions!).toContain('ON DELETE CASCADE');
  });

  test('accounts cascade-delete on user removal', () => {
    const accounts = stmts.find((s) =>
      s.startsWith('CREATE TABLE IF NOT EXISTS "_briven_auth_accounts"'),
    );
    expect(accounts!).toContain('ON DELETE CASCADE');
  });

  test('audit_log preserves rows when user is deleted (forensic value)', () => {
    const audit = stmts.find((s) =>
      s.startsWith('CREATE TABLE IF NOT EXISTS "_briven_auth_audit_log"'),
    );
    expect(audit!).toContain('ON DELETE SET NULL');
  });

  test('accounts has the (provider_id, provider_account_id) uniqueness constraint', () => {
    const uniq = stmts.find(
      (s) =>
        s.includes('_briven_auth_accounts_provider_pair_uniq') &&
        s.includes('UNIQUE') &&
        s.includes('provider_id'),
    );
    expect(uniq).toBeDefined();
  });

  test('S2.1b: verification table uses Better-Auth shape (value, not value_hash)', () => {
    const verif = stmts.find((s) =>
      s.startsWith('CREATE TABLE IF NOT EXISTS "_briven_auth_verification_tokens"'),
    );
    expect(verif!).toContain('value text NOT NULL');
    expect(verif!).not.toContain('value_hash');
  });

  test('audit_log metadata defaults to empty jsonb', () => {
    const audit = stmts.find((s) =>
      s.startsWith('CREATE TABLE IF NOT EXISTS "_briven_auth_audit_log"'),
    );
    expect(audit!).toContain(`jsonb NOT NULL DEFAULT '{}'::jsonb`);
  });

  test('jwks table matches the jwt plugin model (public/private key, created/expires)', () => {
    const jwks = stmts.find((s) =>
      s.startsWith('CREATE TABLE IF NOT EXISTS "_briven_auth_jwks"'),
    );
    expect(jwks).toBeDefined();
    expect(jwks!).toContain('public_key text NOT NULL');
    expect(jwks!).toContain('private_key text NOT NULL');
    expect(jwks!).toContain('created_at timestamptz NOT NULL DEFAULT now()');
    // expiresAt is optional in the plugin schema (only set with key rotation).
    expect(jwks!).toContain('expires_at timestamptz');
    expect(jwks!).not.toContain('expires_at timestamptz NOT NULL');
  });

  test('AUTH_TABLES is exhaustive and matches the emitted CREATE TABLEs', () => {
    expect(AUTH_TABLES.length).toBe(6);
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
