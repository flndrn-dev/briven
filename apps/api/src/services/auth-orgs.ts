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
