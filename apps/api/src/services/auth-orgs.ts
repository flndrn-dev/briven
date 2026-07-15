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
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import { runInProjectDatabase } from '../db/data-plane.js';
import { authOrgInvites, authOrgMembers, authOrgs } from '../db/auth-customer-schema.js';

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
    const [org] = await tx
      .insert(authOrgs)
      .values({
        name: input.name,
        slug: input.slug,
        logo: input.logo ?? null,
      })
      .returning();
    if (!org) throw new Error('org insert failed');

    await tx.insert(authOrgMembers).values({
      orgId: org.id,
      userId,
      role: 'owner',
    });

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logo: org.logo,
      metadata: (org.metadata as Record<string, unknown>) ?? {},
      createdAt: org.createdAt.toISOString(),
    };
  });
}

export async function listOrgsForUser(
  projectId: string,
  userId: string,
): Promise<OrgOutput[]> {
  return runInProjectDatabase<OrgOutput[]>(projectId, async (tx) => {
    const rows = await tx
      .select({
        id: authOrgs.id,
        name: authOrgs.name,
        slug: authOrgs.slug,
        logo: authOrgs.logo,
        metadata: authOrgs.metadata,
        createdAt: authOrgs.createdAt,
      })
      .from(authOrgs)
      .innerJoin(authOrgMembers, eq(authOrgs.id, authOrgMembers.orgId))
      .where(eq(authOrgMembers.userId, userId));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      logo: r.logo,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

export async function getOrg(
  projectId: string,
  orgId: string,
): Promise<OrgOutput | null> {
  return runInProjectDatabase<OrgOutput | null>(projectId, async (tx) => {
    const [row] = await tx
      .select()
      .from(authOrgs)
      .where(eq(authOrgs.id, orgId))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logo: row.logo,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: row.createdAt.toISOString(),
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
    const [row] = await tx
      .update(authOrgs)
      .set({
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.logo !== undefined ? { logo: patch.logo } : {}),
        ...(patch.slug ? { slug: patch.slug } : {}),
        updatedAt: new Date(),
      })
      .where(eq(authOrgs.id, orgId))
      .returning();
    if (!row) throw new ValidationError('org not found');
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logo: row.logo,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function deleteOrg(projectId: string, orgId: string): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.delete(authOrgs).where(eq(authOrgs.id, orgId));
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
    const rows = await tx
      .select()
      .from(authOrgMembers)
      .where(eq(authOrgMembers.orgId, orgId));
    return rows.map((r) => ({
      id: r.id,
      orgId: r.orgId,
      userId: r.userId,
      role: r.role as OrgRole,
      createdAt: r.createdAt.toISOString(),
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
    const [row] = await tx
      .insert(authOrgMembers)
      .values({ orgId, userId, role })
      .onConflictDoNothing({ target: [authOrgMembers.orgId, authOrgMembers.userId] })
      .returning();
    if (!row) throw new ValidationError('user is already a member of this org');
    return {
      id: row.id,
      orgId: row.orgId,
      userId: row.userId,
      role: row.role as OrgRole,
      createdAt: row.createdAt.toISOString(),
    };
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
    const [row] = await tx
      .update(authOrgMembers)
      .set({ role, updatedAt: new Date() })
      .where(and(eq(authOrgMembers.orgId, orgId), eq(authOrgMembers.userId, userId)))
      .returning();
    if (!row) throw new ValidationError('member not found');
    return {
      id: row.id,
      orgId: row.orgId,
      userId: row.userId,
      role: row.role as OrgRole,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function removeOrgMember(
  projectId: string,
  orgId: string,
  userId: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx
      .delete(authOrgMembers)
      .where(and(eq(authOrgMembers.orgId, orgId), eq(authOrgMembers.userId, userId)));
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
    const [row] = await tx
      .insert(authOrgInvites)
      .values({
        orgId,
        email: input.email.toLowerCase(),
        role,
        token,
        expiresAt: new Date(Date.now() + 7 * 86_400_000), // 7 days
        invitedBy: invitedByUserId,
      })
      .returning();
    if (!row) throw new Error('invite insert failed');
    return {
      id: row.id,
      orgId: row.orgId,
      email: row.email,
      role: row.role as OrgRole,
      token: row.token,
      expiresAt: row.expiresAt.toISOString(),
      invitedBy: row.invitedBy,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function getInviteByToken(
  projectId: string,
  token: string,
): Promise<InviteOutput | null> {
  return runInProjectDatabase<InviteOutput | null>(projectId, async (tx) => {
    const [row] = await tx
      .select()
      .from(authOrgInvites)
      .where(and(eq(authOrgInvites.token, token), gt(authOrgInvites.expiresAt, sql`now()`), isNull(authOrgInvites.acceptedAt)))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      orgId: row.orgId,
      email: row.email,
      role: row.role as OrgRole,
      token: row.token,
      expiresAt: row.expiresAt.toISOString(),
      invitedBy: row.invitedBy,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function acceptInvite(
  projectId: string,
  token: string,
  userId: string,
): Promise<{ orgId: string }> {
  return runInProjectDatabase<{ orgId: string }>(projectId, async (tx) => {
    const [invite] = await tx
      .select()
      .from(authOrgInvites)
      .where(
        and(
          eq(authOrgInvites.token, token),
          gt(authOrgInvites.expiresAt, sql`now()`),
          isNull(authOrgInvites.acceptedAt),
        ),
      )
      .limit(1);
    if (!invite) throw new ValidationError('invite not found or expired');

    await tx
      .update(authOrgInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(authOrgInvites.id, invite.id));

    await tx
      .insert(authOrgMembers)
      .values({ orgId: invite.orgId, userId, role: invite.role as OrgRole })
      .onConflictDoNothing({ target: [authOrgMembers.orgId, authOrgMembers.userId] });

    return { orgId: invite.orgId };
  });
}

export async function listPendingInvites(
  projectId: string,
  orgId: string,
): Promise<InviteOutput[]> {
  return runInProjectDatabase<InviteOutput[]>(projectId, async (tx) => {
    const rows = await tx
      .select()
      .from(authOrgInvites)
      .where(and(eq(authOrgInvites.orgId, orgId), isNull(authOrgInvites.acceptedAt)))
      .orderBy(authOrgInvites.createdAt);
    return rows.map((r) => ({
      id: r.id,
      orgId: r.orgId,
      email: r.email,
      role: r.role as OrgRole,
      token: r.token,
      expiresAt: r.expiresAt.toISOString(),
      invitedBy: r.invitedBy,
      acceptedAt: r.acceptedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

export async function revokeInvite(projectId: string, inviteId: string): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.delete(authOrgInvites).where(eq(authOrgInvites.id, inviteId));
  });
}

// ─── Role check ───────────────────────────────────────────────────────────

export async function getUserOrgRole(
  projectId: string,
  orgId: string,
  userId: string,
): Promise<OrgRole | null> {
  return runInProjectDatabase<OrgRole | null>(projectId, async (tx) => {
    const [row] = await tx
      .select({ role: authOrgMembers.role })
      .from(authOrgMembers)
      .where(and(eq(authOrgMembers.orgId, orgId), eq(authOrgMembers.userId, userId)))
      .limit(1);
    return (row?.role as OrgRole) ?? null;
  });
}
