/**
 * SCIM group displayName → Briven org + role (Phase 9.2).
 *
 * When a SCIM Group is created/updated with members, any role map whose
 * display_name matches (case-insensitive) adds those users to the org.
 */

import { NotFoundError, ValidationError, newId } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';
import { addOrgMember } from './auth-orgs.js';
import { ensureScimTables } from './auth-scim.js';
import { log } from '../lib/logger.js';

export interface ScimRoleMap {
  id: string;
  displayName: string;
  orgId: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export async function listScimRoleMaps(projectId: string): Promise<ScimRoleMap[]> {
  await ensureScimTables(projectId);
  // ensure role map table (self-heal)
  await ensureRoleMapTable(projectId);
  const rows = await runInProjectDatabase<
    Array<{
      id: string;
      display_name: string;
      org_id: string;
      role: string;
      created_at: Date;
      updated_at: Date;
    }>
  >(projectId, async (tx) =>
    tx.unsafe(
      `SELECT id, display_name, org_id, role, created_at, updated_at
       FROM "_briven_auth_scim_role_maps"
       ORDER BY display_name ASC`,
    ),
  );
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    orgId: r.org_id,
    role: r.role,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function upsertScimRoleMap(
  projectId: string,
  input: { displayName: string; orgId: string; role?: string },
): Promise<ScimRoleMap> {
  await ensureScimTables(projectId);
  await ensureRoleMapTable(projectId);
  const displayName = input.displayName.trim();
  if (!displayName) throw new ValidationError('displayName required');
  if (!input.orgId.trim()) throw new ValidationError('orgId required');
  const role = (input.role ?? 'member').trim() || 'member';
  const id = newId('scimm');
  const now = new Date().toISOString();

  await runInProjectDatabase(projectId, async (tx) => {
    // Store + match display names case-insensitively by normalizing to lower
    // on write. DoltGres rejects expression indexes on lower(col).
    const nameKey = displayName.toLowerCase();
    const existing = (await tx.unsafe(
      `SELECT id FROM "_briven_auth_scim_role_maps" WHERE display_name = $1 LIMIT 1`,
      [nameKey] as never[],
    )) as Array<{ id: string }>;
    if (existing[0]) {
      await tx.unsafe(
        `UPDATE "_briven_auth_scim_role_maps"
         SET org_id = $2, role = $3, updated_at = $4::timestamptz
         WHERE id = $1`,
        [existing[0].id, input.orgId, role, now] as never[],
      );
    } else {
      await tx.unsafe(
        `INSERT INTO "_briven_auth_scim_role_maps"
           (id, display_name, org_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz)`,
        [id, nameKey, input.orgId, role, now] as never[],
      );
    }
  });

  const maps = await listScimRoleMaps(projectId);
  const found = maps.find((m) => m.displayName.toLowerCase() === displayName.toLowerCase());
  if (!found) throw new Error('role map upsert failed');
  return found;
}

export async function deleteScimRoleMap(projectId: string, mapId: string): Promise<void> {
  await ensureRoleMapTable(projectId);
  const deleted = await runInProjectDatabase<Array<{ id: string }>>(projectId, async (tx) =>
    tx.unsafe(
      `DELETE FROM "_briven_auth_scim_role_maps" WHERE id = $1 RETURNING id`,
      [mapId] as never[],
    ),
  );
  if (deleted.length === 0) throw new NotFoundError('role map not found');
}

/**
 * Apply maps for a SCIM group: for each member SCIM user id, resolve
 * platform user_id and add to mapped org with role.
 */
export async function applyScimGroupRoleMaps(
  projectId: string,
  groupDisplayName: string,
  memberScimUserIds: string[],
): Promise<{ applied: number; errors: string[] }> {
  await ensureRoleMapTable(projectId);
  const maps = await listScimRoleMaps(projectId);
  const map = maps.find((m) => m.displayName.toLowerCase() === groupDisplayName.toLowerCase());
  if (!map) return { applied: 0, errors: [] };

  let applied = 0;
  const errors: string[] = [];

  for (const scimUserId of memberScimUserIds) {
    try {
      const rows = await runInProjectDatabase<Array<{ user_id: string }>>(projectId, async (tx) =>
        tx.unsafe(
          `SELECT user_id FROM "_briven_auth_scim_users" WHERE id = $1 LIMIT 1`,
          [scimUserId] as never[],
        ),
      );
      const userId = rows[0]?.user_id;
      if (!userId) {
        errors.push(`no user for scim id ${scimUserId}`);
        continue;
      }
      const role = map.role === 'admin' ? 'admin' : 'member';
      try {
        await addOrgMember(projectId, map.orgId, userId, role);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Already a member is success for IdP re-sync.
        if (!/already a member/i.test(msg)) throw err;
      }
      applied += 1;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  log.info('scim_group_role_map_applied', {
    projectId,
    groupDisplayName,
    orgId: map.orgId,
    role: map.role,
    applied,
    errors: errors.length,
  });

  return { applied, errors };
}

async function ensureRoleMapTable(projectId: string): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `CREATE TABLE IF NOT EXISTS "_briven_auth_scim_role_maps" (
         id text PRIMARY KEY,
         display_name text NOT NULL,
         org_id text NOT NULL,
         role text NOT NULL DEFAULT 'member',
         created_at timestamptz NOT NULL DEFAULT now(),
         updated_at timestamptz NOT NULL DEFAULT now()
       )`.replace(/\s+/g, ' '),
    );
    await tx.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_scim_role_maps_name_uniq"
         ON "_briven_auth_scim_role_maps" (display_name)`.replace(/\s+/g, ' '),
    );
  });
}
