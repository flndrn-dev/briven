import { describe, expect, test } from 'bun:test';

import {
  AUTH_SELF_HEAL_TABLE_SQL,
  ensureTenantAuthSchema,
  type AuthSchemaQueryClient,
} from './auth-provisioning.js';

describe('ensureTenantAuthSchema', () => {
  test('AUTH_SELF_HEAL_TABLE_SQL includes email templates, passkeys, two_factors, jwks', () => {
    const blob = AUTH_SELF_HEAL_TABLE_SQL.join('\n');
    expect(blob).toContain('_briven_auth_email_templates');
    expect(blob).toContain('_briven_auth_passkeys');
    expect(blob).toContain('_briven_auth_two_factors');
    expect(blob).toContain('_briven_auth_jwks');
    expect(blob).toContain('CREATE TABLE IF NOT EXISTS');
  });

  test('adds two_factor_enabled when column probe returns empty', async () => {
    const executed: string[] = [];
    const client: AuthSchemaQueryClient = {
      async query(sql: string) {
        executed.push(sql.replace(/\s+/g, ' ').trim());
        if (sql.includes('information_schema.columns')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
    const result = await ensureTenantAuthSchema(client);
    expect(result.columnAdded).toBe(true);
    expect(result.tablesOk).toBe(AUTH_SELF_HEAL_TABLE_SQL.length);
    expect(executed.some((s) => s.includes('ADD COLUMN two_factor_enabled'))).toBe(true);
  });

  test('skips ADD COLUMN when two_factor_enabled already exists', async () => {
    const executed: string[] = [];
    const client: AuthSchemaQueryClient = {
      async query(sql: string) {
        executed.push(sql.replace(/\s+/g, ' ').trim());
        if (sql.includes('information_schema.columns')) {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      },
    };
    const result = await ensureTenantAuthSchema(client);
    expect(result.columnAdded).toBe(false);
    expect(executed.some((s) => s.includes('ADD COLUMN two_factor_enabled'))).toBe(false);
  });

  test('heals passkey device_type when missing', async () => {
    const executed: string[] = [];
    const client: AuthSchemaQueryClient = {
      async query(sql: string, params?: unknown[]) {
        executed.push(sql.replace(/\s+/g, ' ').trim());
        if (sql.includes('information_schema.columns') && params?.[0] === 'device_type') {
          return { rows: [] };
        }
        if (sql.includes('information_schema.columns')) {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      },
    };
    const result = await ensureTenantAuthSchema(client);
    expect(result.columnAdded).toBe(true);
    expect(executed.some((s) => s.includes('ADD COLUMN device_type'))).toBe(true);
  });
});
