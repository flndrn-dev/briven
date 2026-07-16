/**
 * Briven Auth Organizations — customer-facing multi-tenant teams.
 *
 * These tables live in each project's own database (proj_<id>) and are
 * queried via `runInProjectDatabase`. They are NOT Better Auth models;
 * they extend the auth system with org/team management that customer
 * apps consume through the SDK.
 *
 * Roles: owner > admin > member. Only one owner per org; ownership
 * transfers explicitly. Deleting an org cascades to members + invites.
 */

import { ValidationError } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';

const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

function assertRole(role: string): asserts role is OrgRole {
  if (!ORG_ROLES.includes(role as OrgRole)) {
    throw new ValidationError(`invalid org role: ${role}`);
  }
}

// ─── Phase 4 — Permissions ────────────────────────────────────────────────

export const ORG_PERMISSIONS = [
  'org:update',
  'org:delete',
  'member:add',
  'member:remove',
  'member:update_role',
  'invite:create',
  'invite:revoke',
  'invite:list',
  'domain:manage',
  'request:approve',
  'billing:view',
  'billing:manage',
] as const;

export type OrgPermission = (typeof ORG_PERMISSIONS)[number];

const DEFAULT_ROLE_PERMISSIONS: Record<string, OrgPermission[]> = {
  owner: [...ORG_PERMISSIONS],
  admin: ORG_PERMISSIONS.filter((p) => p !== 'org:delete' && p !== 'billing:manage'),
  member: ['billing:view'],
};

function assertPermission(perm: string): asserts perm is OrgPermission {
  if (!ORG_PERMISSIONS.includes(perm as OrgPermission)) {
    throw new ValidationError(`invalid org permission: ${perm}`);
  }
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Org CRUD ─────────────────────────────────────────────────────────────

export interface CreateOrgInput {
  readonly name: string;
  readonly slug: string;
  readonly logo?: string | null;
}

export interface OrgOutput {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function createOrg(
  projectId: string,
  userId: string,
  input: CreateOrgInput,
): Promise<OrgOutput> {
  if (!input.name || input.name.length > 128) {
    throw new ValidationError('name is required and must be <= 128 chars');
  }
  if (!input.slug || !/^[a-z0-9-]{1,64}$/.test(input.slug)) {
    throw new ValidationError('slug must be 1-64 lowercase alphanumerics or hyphens');
  }

  return runInProjectDatabase<OrgOutput>(projectId, async (tx) => {
    const orgRows = (await tx.unsafe(
      `INSERT INTO "_briven_auth_orgs" (name, slug, logo)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug, logo, metadata, created_at`,
      [input.name, input.slug, input.logo ?? null],
    )) as {
      id: string; name: string; slug: string; logo: string | null;
      metadata: unknown; created_at: Date;
    }[];
    const org = orgRows[0];
    if (!org) throw new Error('org insert failed');

    await tx.unsafe(
      `INSERT INTO "_briven_auth_org_members" (org_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [org.id, userId],
    );

    // Seed default roles (Phase 4)
    for (const [roleName, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      await tx.unsafe(
        `INSERT INTO "_briven_auth_org_roles" (org_id, name, permissions, is_system)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (org_id, name) DO NOTHING`,
        [org.id, roleName, JSON.stringify(perms)],
      );
    }

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logo: org.logo,
      metadata: (org.metadata as Record<string, unknown>) ?? {},
      createdAt: org.created_at.toISOString(),
    };
  });
}

export async function listOrgsForUser(
  projectId: string,
  userId: string,
): Promise<OrgOutput[]> {
  return runInProjectDatabase<OrgOutput[]>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT o.id, o.name, o.slug, o.logo, o.metadata, o.created_at
       FROM "_briven_auth_orgs" o
       INNER JOIN "_briven_auth_org_members" m ON o.id = m.org_id
       WHERE m.user_id = $1`,
      [userId],
    )) as {
      id: string; name: string; slug: string; logo: string | null;
      metadata: unknown; created_at: Date;
    }[];

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      logo: r.logo,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      createdAt: r.created_at.toISOString(),
    }));
  });
}

export async function getOrg(
  projectId: string,
  orgId: string,
): Promise<OrgOutput | null> {
  return runInProjectDatabase<OrgOutput | null>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT id, name, slug, logo, metadata, created_at
       FROM "_briven_auth_orgs"
       WHERE id = $1
       LIMIT 1`,
      [orgId],
    )) as {
      id: string; name: string; slug: string; logo: string | null;
      metadata: unknown; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logo: row.logo,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function updateOrg(
  projectId: string,
  orgId: string,
  patch: { name?: string; logo?: string | null; slug?: string },
): Promise<OrgOutput> {
  if (patch.slug && !/^[a-z0-9-]{1,64}$/.test(patch.slug)) {
    throw new ValidationError('slug must be 1-64 lowercase alphanumerics or hyphens');
  }
  return runInProjectDatabase<OrgOutput>(projectId, async (tx) => {
    const sets: string[] = [];
    const params: (string | null)[] = [];
    if (patch.name) {
      sets.push(`name = $${params.length + 1}`);
      params.push(patch.name);
    }
    if (patch.logo !== undefined) {
      sets.push(`logo = $${params.length + 1}`);
      params.push(patch.logo);
    }
    if (patch.slug) {
      sets.push(`slug = $${params.length + 1}`);
      params.push(patch.slug);
    }
    sets.push(`updated_at = now()`);
    params.push(orgId);

    const rows = (await tx.unsafe(
      `UPDATE "_briven_auth_orgs"
       SET ${sets.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, name, slug, logo, metadata, created_at`,
      params,
    )) as {
      id: string; name: string; slug: string; logo: string | null;
      metadata: unknown; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) throw new ValidationError('org not found');
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logo: row.logo,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function deleteOrg(projectId: string, orgId: string): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `DELETE FROM "_briven_auth_orgs" WHERE id = $1`,
      [orgId],
    );
  });
}

// ─── Members ──────────────────────────────────────────────────────────────

export interface MemberOutput {
  id: string;
  orgId: string;
  userId: string;
  role: OrgRole;
  createdAt: string;
}

export async function listOrgMembers(
  projectId: string,
  orgId: string,
): Promise<MemberOutput[]> {
  return runInProjectDatabase<MemberOutput[]>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT id, org_id, user_id, role, created_at
       FROM "_briven_auth_org_members"
       WHERE org_id = $1`,
      [orgId],
    )) as {
      id: string; org_id: string; user_id: string; role: string; created_at: Date;
    }[];
    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      userId: r.user_id,
      role: r.role as OrgRole,
      createdAt: r.created_at.toISOString(),
    }));
  });
}

export async function addOrgMember(
  projectId: string,
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<MemberOutput> {
  assertRole(role);
  return runInProjectDatabase<MemberOutput>(projectId, async (tx) => {
    try {
      const rows = (await tx.unsafe(
        `INSERT INTO "_briven_auth_org_members" (org_id, user_id, role)
         VALUES ($1, $2, $3)
         RETURNING id, org_id, user_id, role, created_at`,
        [orgId, userId, role],
      )) as {
        id: string; org_id: string; user_id: string; role: string; created_at: Date;
      }[];
      const row = rows[0];
      if (!row) throw new ValidationError('user is already a member of this org');
      return {
        id: row.id,
        orgId: row.org_id,
        userId: row.user_id,
        role: row.role as OrgRole,
        createdAt: row.created_at.toISOString(),
      };
    } catch (err) {
      // 23505 = unique_violation (ON CONFLICT not used with unsafe)
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
        throw new ValidationError('user is already a member of this org');
      }
      throw err;
    }
  });
}

export async function updateMemberRole(
  projectId: string,
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<MemberOutput> {
  assertRole(role);
  return runInProjectDatabase<MemberOutput>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `UPDATE "_briven_auth_org_members"
       SET role = $1, updated_at = now()
       WHERE org_id = $2 AND user_id = $3
       RETURNING id, org_id, user_id, role, created_at`,
      [role, orgId, userId],
    )) as {
      id: string; org_id: string; user_id: string; role: string; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) throw new ValidationError('member not found');
    return {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      role: row.role as OrgRole,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function removeOrgMember(
  projectId: string,
  orgId: string,
  userId: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `DELETE FROM "_briven_auth_org_members"
       WHERE org_id = $1 AND user_id = $2`,
      [orgId, userId],
    );
  });
}

// ─── Invitations ──────────────────────────────────────────────────────────

export interface InviteOutput {
  id: string;
  orgId: string;
  email: string;
  role: OrgRole;
  token: string;
  expiresAt: string;
  invitedBy: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

export async function createOrgInvite(
  projectId: string,
  orgId: string,
  invitedByUserId: string,
  input: { email: string; role?: OrgRole },
): Promise<InviteOutput> {
  const role = input.role ?? 'member';
  assertRole(role);
  if (!input.email || !input.email.includes('@')) {
    throw new ValidationError('valid email is required');
  }

  return runInProjectDatabase<InviteOutput>(projectId, async (tx) => {
    const token = newToken();
    const rows = (await tx.unsafe(
      `INSERT INTO "_briven_auth_org_invites"
         (org_id, email, role, token, expires_at, invited_by)
       VALUES ($1, $2, $3, $4, now() + interval '7 days', $5)
       RETURNING id, org_id, email, role, token, expires_at, invited_by, accepted_at, created_at`,
      [orgId, input.email.toLowerCase(), role, token, invitedByUserId],
    )) as {
      id: string; org_id: string; email: string; role: string; token: string;
      expires_at: Date; invited_by: string | null; accepted_at: Date | null; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) throw new Error('invite insert failed');
    return {
      id: row.id,
      orgId: row.org_id,
      email: row.email,
      role: row.role as OrgRole,
      token: row.token,
      expiresAt: row.expires_at.toISOString(),
      invitedBy: row.invited_by,
      acceptedAt: row.accepted_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function getInviteByToken(
  projectId: string,
  token: string,
): Promise<InviteOutput | null> {
  return runInProjectDatabase<InviteOutput | null>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT id, org_id, email, role, token, expires_at, invited_by, accepted_at, created_at
       FROM "_briven_auth_org_invites"
       WHERE token = $1 AND expires_at > now() AND accepted_at IS NULL
       LIMIT 1`,
      [token],
    )) as {
      id: string; org_id: string; email: string; role: string; token: string;
      expires_at: Date; invited_by: string | null; accepted_at: Date | null; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      orgId: row.org_id,
      email: row.email,
      role: row.role as OrgRole,
      token: row.token,
      expiresAt: row.expires_at.toISOString(),
      invitedBy: row.invited_by,
      acceptedAt: row.accepted_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function acceptInvite(
  projectId: string,
  token: string,
  userId: string,
): Promise<{ orgId: string }> {
  return runInProjectDatabase<{ orgId: string }>(projectId, async (tx) => {
    const invites = (await tx.unsafe(
      `SELECT id, org_id, role FROM "_briven_auth_org_invites"
       WHERE token = $1 AND expires_at > now() AND accepted_at IS NULL
       LIMIT 1`,
      [token],
    )) as { id: string; org_id: string; role: string }[];
    const invite = invites[0];
    if (!invite) throw new ValidationError('invite not found or expired');

    await tx.unsafe(
      `UPDATE "_briven_auth_org_invites" SET accepted_at = now() WHERE id = $1`,
      [invite.id],
    );

    await tx.unsafe(
      `INSERT INTO "_briven_auth_org_members" (org_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [invite.org_id, userId, invite.role],
    );

    return { orgId: invite.org_id };
  });
}

export async function listPendingInvites(
  projectId: string,
  orgId: string,
): Promise<InviteOutput[]> {
  return runInProjectDatabase<InviteOutput[]>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT id, org_id, email, role, token, expires_at, invited_by, accepted_at, created_at
       FROM "_briven_auth_org_invites"
       WHERE org_id = $1 AND accepted_at IS NULL
       ORDER BY created_at`,
      [orgId],
    )) as {
      id: string; org_id: string; email: string; role: string; token: string;
      expires_at: Date; invited_by: string; accepted_at: Date | null; created_at: Date;
    }[];
    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      email: r.email,
      role: r.role as OrgRole,
      token: r.token,
      expiresAt: r.expires_at.toISOString(),
      invitedBy: r.invited_by,
      acceptedAt: r.accepted_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
    }));
  });
}

export async function revokeInvite(projectId: string, inviteId: string): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `DELETE FROM "_briven_auth_org_invites" WHERE id = $1`,
      [inviteId],
    );
  });
}

// ─── Role check ───────────────────────────────────────────────────────────

export async function getUserOrgRole(
  projectId: string,
  orgId: string,
  userId: string,
): Promise<OrgRole | null> {
  return runInProjectDatabase<OrgRole | null>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT role FROM "_briven_auth_org_members" WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
      [orgId, userId],
    )) as { role: string }[];
    return (rows[0]?.role as OrgRole) ?? null;
  });
}

// ─── Phase 4 — Permissions ────────────────────────────────────────────────

export async function getUserOrgPermissions(
  projectId: string,
  orgId: string,
  userId: string,
): Promise<OrgPermission[]> {
  return runInProjectDatabase<OrgPermission[]>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT m.role, r.permissions
       FROM "_briven_auth_org_members" m
       LEFT JOIN "_briven_auth_org_roles" r
         ON r.org_id = m.org_id AND r.name = m.role
       WHERE m.org_id = $1 AND m.user_id = $2
       LIMIT 1`,
      [orgId, userId],
    )) as { role: string; permissions: unknown }[];
    const row = rows[0];
    if (!row) return [];
    // Fallback to hardcoded defaults if roles table row missing (legacy orgs)
    if (!row.permissions) {
      return (DEFAULT_ROLE_PERMISSIONS[row.role] ?? []) as OrgPermission[];
    }
    const perms = Array.isArray(row.permissions) ? row.permissions : [];
    return perms.filter((p): p is OrgPermission =>
      ORG_PERMISSIONS.includes(p as OrgPermission),
    );
  });
}

export async function hasPermission(
  projectId: string,
  orgId: string,
  userId: string,
  permission: OrgPermission,
): Promise<boolean> {
  const perms = await getUserOrgPermissions(projectId, orgId, userId);
  return perms.includes(permission);
}

// ─── Phase 4 — Custom Roles ───────────────────────────────────────────────

export interface OrgRoleOutput {
  id: string;
  orgId: string;
  name: string;
  permissions: OrgPermission[];
  isSystem: boolean;
  createdAt: string;
}

export async function listOrgRoles(
  projectId: string,
  orgId: string,
): Promise<OrgRoleOutput[]> {
  return runInProjectDatabase<OrgRoleOutput[]>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT id, org_id, name, permissions, is_system, created_at
       FROM "_briven_auth_org_roles"
       WHERE org_id = $1
       ORDER BY created_at`,
      [orgId],
    )) as {
      id: string; org_id: string; name: string; permissions: unknown;
      is_system: boolean; created_at: Date;
    }[];
    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      name: r.name,
      permissions: Array.isArray(r.permissions)
        ? (r.permissions as string[]).filter((p): p is OrgPermission =>
            ORG_PERMISSIONS.includes(p as OrgPermission),
          )
        : [],
      isSystem: r.is_system,
      createdAt: r.created_at.toISOString(),
    }));
  });
}

export async function createOrgRole(
  projectId: string,
  orgId: string,
  input: { name: string; permissions: OrgPermission[] },
): Promise<OrgRoleOutput> {
  if (!input.name || input.name.length > 64) {
    throw new ValidationError('name is required and must be <= 64 chars');
  }
  if (!Array.isArray(input.permissions)) {
    throw new ValidationError('permissions must be an array');
  }
  for (const p of input.permissions) assertPermission(p);
  return runInProjectDatabase<OrgRoleOutput>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `INSERT INTO "_briven_auth_org_roles" (org_id, name, permissions)
       VALUES ($1, $2, $3)
       RETURNING id, org_id, name, permissions, is_system, created_at`,
      [orgId, input.name, JSON.stringify(input.permissions)],
    )) as {
      id: string; org_id: string; name: string; permissions: unknown;
      is_system: boolean; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) throw new Error('role insert failed');
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      permissions: Array.isArray(row.permissions)
        ? (row.permissions as string[]).filter((p): p is OrgPermission =>
            ORG_PERMISSIONS.includes(p as OrgPermission),
          )
        : [],
      isSystem: row.is_system,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function updateOrgRole(
  projectId: string,
  orgId: string,
  roleId: string,
  input: { name?: string; permissions?: OrgPermission[] },
): Promise<OrgRoleOutput> {
  return runInProjectDatabase<OrgRoleOutput>(projectId, async (tx) => {
    const existing = (await tx.unsafe(
      `SELECT is_system FROM "_briven_auth_org_roles"
       WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [roleId, orgId],
    )) as { is_system: boolean }[];
    if (!existing[0]) throw new ValidationError('role not found');
    if (existing[0].is_system) {
      throw new ValidationError('system roles cannot be modified');
    }

    const sets: string[] = [];
    const params: (string | null)[] = [];
    if (input.name) {
      sets.push(`name = $${params.length + 1}`);
      params.push(input.name);
    }
    if (input.permissions) {
      for (const p of input.permissions) assertPermission(p);
      sets.push(`permissions = $${params.length + 1}`);
      params.push(JSON.stringify(input.permissions));
    }
    sets.push(`updated_at = now()`);
    params.push(roleId);

    const rows = (await tx.unsafe(
      `UPDATE "_briven_auth_org_roles"
       SET ${sets.join(', ')}
       WHERE id = $${params.length} AND org_id = $${params.length + 1}
       RETURNING id, org_id, name, permissions, is_system, created_at`,
      [...params, orgId],
    )) as {
      id: string; org_id: string; name: string; permissions: unknown;
      is_system: boolean; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) throw new ValidationError('role not found');
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      permissions: Array.isArray(row.permissions)
        ? (row.permissions as string[]).filter((p): p is OrgPermission =>
            ORG_PERMISSIONS.includes(p as OrgPermission),
          )
        : [],
      isSystem: row.is_system,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function deleteOrgRole(
  projectId: string,
  orgId: string,
  roleId: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    const existing = (await tx.unsafe(
      `SELECT is_system FROM "_briven_auth_org_roles"
       WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [roleId, orgId],
    )) as { is_system: boolean }[];
    if (!existing[0]) throw new ValidationError('role not found');
    if (existing[0].is_system) {
      throw new ValidationError('system roles cannot be deleted');
    }
    await tx.unsafe(
      `DELETE FROM "_briven_auth_org_roles" WHERE id = $1 AND org_id = $2`,
      [roleId, orgId],
    );
  });
}

// ─── Phase 4 — Domain Verification ────────────────────────────────────────

export interface OrgDomainOutput {
  id: string;
  orgId: string;
  domain: string;
  verificationToken: string;
  verifiedAt: string | null;
  autoJoinEnabled: boolean;
  createdAt: string;
}

function newDomainToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'briven-verify=' + Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function listOrgDomains(
  projectId: string,
  orgId: string,
): Promise<OrgDomainOutput[]> {
  return runInProjectDatabase<OrgDomainOutput[]>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT id, org_id, domain, verification_token, verified_at, auto_join_enabled, created_at
       FROM "_briven_auth_org_domains"
       WHERE org_id = $1
       ORDER BY created_at`,
      [orgId],
    )) as {
      id: string; org_id: string; domain: string; verification_token: string;
      verified_at: Date | null; auto_join_enabled: boolean; created_at: Date;
    }[];
    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      domain: r.domain,
      verificationToken: r.verification_token,
      verifiedAt: r.verified_at?.toISOString() ?? null,
      autoJoinEnabled: r.auto_join_enabled,
      createdAt: r.created_at.toISOString(),
    }));
  });
}

export async function addOrgDomain(
  projectId: string,
  orgId: string,
  domain: string,
): Promise<OrgDomainOutput> {
  if (!domain || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
    throw new ValidationError('invalid domain format');
  }
  const token = newDomainToken();
  return runInProjectDatabase<OrgDomainOutput>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `INSERT INTO "_briven_auth_org_domains" (org_id, domain, verification_token)
       VALUES ($1, $2, $3)
       RETURNING id, org_id, domain, verification_token, verified_at, auto_join_enabled, created_at`,
      [orgId, domain.toLowerCase(), token],
    )) as {
      id: string; org_id: string; domain: string; verification_token: string;
      verified_at: Date | null; auto_join_enabled: boolean; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) throw new Error('domain insert failed');
    return {
      id: row.id,
      orgId: row.org_id,
      domain: row.domain,
      verificationToken: row.verification_token,
      verifiedAt: row.verified_at?.toISOString() ?? null,
      autoJoinEnabled: row.auto_join_enabled,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function verifyOrgDomain(
  projectId: string,
  orgId: string,
  domainId: string,
): Promise<OrgDomainOutput> {
  return runInProjectDatabase<OrgDomainOutput>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `UPDATE "_briven_auth_org_domains"
       SET verified_at = now(), updated_at = now()
       WHERE id = $1 AND org_id = $2
       RETURNING id, org_id, domain, verification_token, verified_at, auto_join_enabled, created_at`,
      [domainId, orgId],
    )) as {
      id: string; org_id: string; domain: string; verification_token: string;
      verified_at: Date | null; auto_join_enabled: boolean; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) throw new ValidationError('domain not found');
    return {
      id: row.id,
      orgId: row.org_id,
      domain: row.domain,
      verificationToken: row.verification_token,
      verifiedAt: row.verified_at?.toISOString() ?? null,
      autoJoinEnabled: row.auto_join_enabled,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function setOrgDomainAutoJoin(
  projectId: string,
  orgId: string,
  domainId: string,
  enabled: boolean,
): Promise<OrgDomainOutput> {
  return runInProjectDatabase<OrgDomainOutput>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `UPDATE "_briven_auth_org_domains"
       SET auto_join_enabled = $1, updated_at = now()
       WHERE id = $2 AND org_id = $3
       RETURNING id, org_id, domain, verification_token, verified_at, auto_join_enabled, created_at`,
      [enabled, domainId, orgId],
    )) as {
      id: string; org_id: string; domain: string; verification_token: string;
      verified_at: Date | null; auto_join_enabled: boolean; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) throw new ValidationError('domain not found');
    return {
      id: row.id,
      orgId: row.org_id,
      domain: row.domain,
      verificationToken: row.verification_token,
      verifiedAt: row.verified_at?.toISOString() ?? null,
      autoJoinEnabled: row.auto_join_enabled,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function removeOrgDomain(
  projectId: string,
  orgId: string,
  domainId: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `DELETE FROM "_briven_auth_org_domains" WHERE id = $1 AND org_id = $2`,
      [domainId, orgId],
    );
  });
}

export async function getVerifiedDomainForEmail(
  projectId: string,
  email: string,
): Promise<{ orgId: string; domain: string } | null> {
  const domainPart = email.split('@')[1];
  if (!domainPart) return null;
  return runInProjectDatabase<{ orgId: string; domain: string } | null>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT org_id, domain FROM "_briven_auth_org_domains"
       WHERE domain = $1 AND verified_at IS NOT NULL AND auto_join_enabled = true
       LIMIT 1`,
      [domainPart.toLowerCase()],
    )) as { org_id: string; domain: string }[];
    const row = rows[0];
    if (!row) return null;
    return { orgId: row.org_id, domain: row.domain };
  });
}

/** Auto-add a user to an org if their email domain matches a verified auto-join domain. */
export async function maybeAutoJoinOrg(
  projectId: string,
  userId: string,
  email: string,
): Promise<{ orgId: string } | null> {
  const match = await getVerifiedDomainForEmail(projectId, email);
  if (!match) return null;
  try {
    await addOrgMember(projectId, match.orgId, userId, 'member');
  } catch {
    // Already a member — swallow.
  }
  return { orgId: match.orgId };
}

// ─── Phase 4 — Membership Requests ────────────────────────────────────────

export interface MembershipRequestOutput {
  id: string;
  orgId: string;
  userId: string;
  status: 'pending' | 'approved' | 'rejected';
  message: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

export async function createMembershipRequest(
  projectId: string,
  orgId: string,
  userId: string,
  message?: string,
): Promise<MembershipRequestOutput> {
  return runInProjectDatabase<MembershipRequestOutput>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `INSERT INTO "_briven_auth_org_membership_requests"
         (org_id, user_id, status, message)
       VALUES ($1, $2, 'pending', $3)
       ON CONFLICT (org_id, user_id) DO UPDATE SET
         status = 'pending',
         message = COALESCE(EXCLUDED.message, "_briven_auth_org_membership_requests".message),
         resolved_at = NULL,
         resolved_by = NULL,
         updated_at = now()
       RETURNING id, org_id, user_id, status, message, requested_at, resolved_at, resolved_by, created_at`,
      [orgId, userId, message ?? null],
    )) as {
      id: string; org_id: string; user_id: string; status: string;
      message: string | null; requested_at: Date; resolved_at: Date | null;
      resolved_by: string | null; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) throw new Error('membership request insert failed');
    return {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      status: row.status as MembershipRequestOutput['status'],
      message: row.message,
      requestedAt: row.requested_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      resolvedBy: row.resolved_by,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function listMembershipRequests(
  projectId: string,
  orgId: string,
  status?: 'pending' | 'approved' | 'rejected',
): Promise<MembershipRequestOutput[]> {
  return runInProjectDatabase<MembershipRequestOutput[]>(projectId, async (tx) => {
    const sql = status
      ? `SELECT id, org_id, user_id, status, message, requested_at, resolved_at, resolved_by, created_at
         FROM "_briven_auth_org_membership_requests"
         WHERE org_id = $1 AND status = $2
         ORDER BY requested_at DESC`
      : `SELECT id, org_id, user_id, status, message, requested_at, resolved_at, resolved_by, created_at
         FROM "_briven_auth_org_membership_requests"
         WHERE org_id = $1
         ORDER BY requested_at DESC`;
    const params = status ? [orgId, status] : [orgId];
    const rows = (await tx.unsafe(sql, params)) as {
      id: string; org_id: string; user_id: string; status: string;
      message: string | null; requested_at: Date; resolved_at: Date | null;
      resolved_by: string | null; created_at: Date;
    }[];
    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      userId: r.user_id,
      status: r.status as MembershipRequestOutput['status'],
      message: r.message,
      requestedAt: r.requested_at.toISOString(),
      resolvedAt: r.resolved_at?.toISOString() ?? null,
      resolvedBy: r.resolved_by,
      createdAt: r.created_at.toISOString(),
    }));
  });
}

export async function resolveMembershipRequest(
  projectId: string,
  orgId: string,
  requestId: string,
  resolverUserId: string,
  decision: 'approved' | 'rejected',
): Promise<MembershipRequestOutput> {
  return runInProjectDatabase<MembershipRequestOutput>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `UPDATE "_briven_auth_org_membership_requests"
       SET status = $1, resolved_at = now(), resolved_by = $2, updated_at = now()
       WHERE id = $3 AND org_id = $4
       RETURNING id, org_id, user_id, status, message, requested_at, resolved_at, resolved_by, created_at`,
      [decision, resolverUserId, requestId, orgId],
    )) as {
      id: string; org_id: string; user_id: string; status: string;
      message: string | null; requested_at: Date; resolved_at: Date | null;
      resolved_by: string | null; created_at: Date;
    }[];
    const row = rows[0];
    if (!row) throw new ValidationError('request not found');

    if (decision === 'approved') {
      await tx.unsafe(
        `INSERT INTO "_briven_auth_org_members" (org_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT (org_id, user_id) DO NOTHING`,
        [orgId, row.user_id],
      );
    }

    return {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      status: row.status as MembershipRequestOutput['status'],
      message: row.message,
      requestedAt: row.requested_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      resolvedBy: row.resolved_by,
      createdAt: row.created_at.toISOString(),
    };
  });
}

// ─── Phase 4 — Active Organization per Session ────────────────────────────

export async function setSessionActiveOrg(
  projectId: string,
  sessionId: string,
  orgId: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_session_orgs" (session_id, org_id)
       VALUES ($1, $2)
       ON CONFLICT (session_id) DO UPDATE SET
         org_id = EXCLUDED.org_id,
         updated_at = now()`,
      [sessionId, orgId],
    );
  });
}

export async function getSessionActiveOrg(
  projectId: string,
  sessionId: string,
): Promise<string | null> {
  return runInProjectDatabase<string | null>(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT org_id FROM "_briven_auth_session_orgs"
       WHERE session_id = $1 LIMIT 1`,
      [sessionId],
    )) as { org_id: string }[];
    return rows[0]?.org_id ?? null;
  });
}

export async function clearSessionActiveOrg(
  projectId: string,
  sessionId: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `DELETE FROM "_briven_auth_session_orgs" WHERE session_id = $1`,
      [sessionId],
    );
  });
}
