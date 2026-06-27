import { randomBytes } from 'node:crypto';

import { newId, NotFoundError, ValidationError } from '@briven/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { dbNameFor, dropProjectDatabase, provisionProjectDatabase } from '../db/data-plane.js';
import {
  projects,
  projectMembers,
  orgMembers,
  type Project,
  type NewProject,
} from '../db/schema.js';
import { log } from '../lib/logger.js';
import { resolveProjectAccess, type ProjectAccess } from './access.js';
import { getTierForOrg } from './billing.js';
import { assertProjectCreateAllowed } from './tiers.js';

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function genSlug(): string {
  // 12 chars of url-safe lowercase alphanumerics.
  const bytes = randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += SLUG_ALPHABET[bytes[i]! % SLUG_ALPHABET.length];
  }
  return s;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export interface CreateProjectInput {
  name: string;
  orgId: string;
  createdByUserId: string;
  slug?: string;
  region?: string;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const slug = input.slug ?? genSlug();
  if (!isValidSlug(slug)) {
    throw new ValidationError('slug must be lowercase alphanumeric with hyphens, 1-32 chars', {
      slug,
    });
  }

  const tier = await getTierForOrg(input.orgId);
  await assertProjectCreateAllowed(input.orgId, tier);

  const projectId = newId('p');
  const row: NewProject = {
    id: projectId,
    slug,
    name: input.name,
    orgId: input.orgId,
    region: input.region ?? 'eu-west-1',
    tier: 'free',
    // Field name kept for API/schema stability; value is now the per-project
    // DoltGres database name (database-per-project), not a schema name.
    dataSchemaName: dbNameFor(projectId),
  };

  const db = getDb();
  const [created] = await db.insert(projects).values(row).returning();
  if (!created) throw new Error('project insert returned no row');

  // Owner is automatically a member with role=owner. Phase 3 RBAC fleshes
  // out the other roles; the row exists from day one for consistency.
  await db.insert(projectMembers).values({
    projectId: created.id,
    userId: input.createdByUserId,
    role: 'owner',
  });

  // Provision the data-plane DATABASE (database-per-project on DoltGres).
  // If this fails we roll back the meta rows so the user can retry with the
  // same slug — leaving the meta row behind would orphan the project (no
  // database, name/slug taken).
  try {
    await provisionProjectDatabase(created.id);
  } catch (err) {
    log.error('project_database_provision_failed', {
      projectId: created.id,
      message: err instanceof Error ? err.message : String(err),
    });
    // Best-effort cleanup. Each step is independent; we don't want a
    // secondary failure to mask the original cause.
    try {
      await dropProjectDatabase(created.id);
    } catch (dropErr) {
      log.warn('project_rollback_database_drop_failed', {
        projectId: created.id,
        message: dropErr instanceof Error ? dropErr.message : String(dropErr),
      });
    }
    try {
      await db.delete(projectMembers).where(eq(projectMembers.projectId, created.id));
    } catch (memberErr) {
      log.warn('project_rollback_member_delete_failed', {
        projectId: created.id,
        message: memberErr instanceof Error ? memberErr.message : String(memberErr),
      });
    }
    try {
      await db.delete(projects).where(eq(projects.id, created.id));
    } catch (rowErr) {
      log.warn('project_rollback_row_delete_failed', {
        projectId: created.id,
        message: rowErr instanceof Error ? rowErr.message : String(rowErr),
      });
    }
    throw err;
  }

  return created;
}

/**
 * Every project the user can see, via either an `orgMembers` row for the
 * project's org or a `projectMembers` row for the project itself
 * (Model B — org-as-baseline + project overrides). De-duplicated and
 * ordered by createdAt desc.
 */
export async function listProjectsForUser(userId: string): Promise<Project[]> {
  const db = getDb();
  const [orgScoped, projectScoped] = await Promise.all([
    db
      .select()
      .from(projects)
      .innerJoin(orgMembers, eq(orgMembers.orgId, projects.orgId))
      .where(and(eq(orgMembers.userId, userId), isNull(projects.deletedAt))),
    db
      .select()
      .from(projects)
      .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
      .where(and(eq(projectMembers.userId, userId), isNull(projects.deletedAt))),
  ]);
  const seen = new Set<string>();
  const merged: Project[] = [];
  for (const r of [...orgScoped, ...projectScoped]) {
    if (seen.has(r.projects.id)) continue;
    seen.add(r.projects.id);
    merged.push(r.projects);
  }
  merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return merged;
}

export async function getProjectForUser(projectId: string, userId: string): Promise<Project> {
  const access = await resolveProjectAccess(projectId, userId);
  if (!access) throw new NotFoundError('project', projectId);
  return access.project;
}

/**
 * Resolve `{ project, effectiveRole }` for a session-authenticated request.
 * Throws `NotFoundError` if the user has no access via either org or
 * project membership. Routes that need to gate by role read the role from
 * this return value or from `c.get('projectRole')` after the middleware
 * runs.
 */
export async function getProjectAccessForUser(
  projectId: string,
  userId: string,
): Promise<ProjectAccess> {
  const access = await resolveProjectAccess(projectId, userId);
  if (!access) throw new NotFoundError('project', projectId);
  return access;
}

/**
 * Fetch a project row without a per-user membership check — callers
 * that reach here have already been auth-gated by requireProjectAuth
 * (which resolves either a session owner OR a project-scoped API key).
 * Used by the `/v1/projects/:id/info` verify-credentials endpoint.
 */
export async function getProjectInfo(projectId: string): Promise<Project> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError('project', projectId);
  return row;
}

export interface UpdateProjectInput {
  name?: string;
  slug?: string;
}

export async function updateProjectForUser(
  projectId: string,
  userId: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const existing = await getProjectForUser(projectId, userId);
  if (input.slug && !isValidSlug(input.slug)) {
    throw new ValidationError('slug must be lowercase alphanumeric with hyphens, 1-32 chars', {
      slug: input.slug,
    });
  }

  const db = getDb();
  const [updated] = await db
    .update(projects)
    .set({
      name: input.name ?? existing.name,
      slug: input.slug ?? existing.slug,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();
  if (!updated) throw new Error('project update returned no row');
  return updated;
}

export async function softDeleteProjectForUser(
  projectId: string,
  userId: string,
): Promise<Project> {
  await getProjectForUser(projectId, userId);
  const db = getDb();
  const now = new Date();
  const [deleted] = await db
    .update(projects)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(projects.id, projectId))
    .returning();
  if (!deleted) throw new Error('project delete returned no row');
  return deleted;
}

/**
 * Re-parent a project to a different org. Caller must be a member of both
 * the source org (already checked via getProjectForUser) AND the target
 * org. Billing and tier roll up to the new org from the next subscription
 * event onward — the existing projects.tier cache flips immediately so
 * rate-limit middleware sees the new tier on the next request.
 */
export async function moveProjectToOrg(args: {
  projectId: string;
  userId: string;
  targetOrgId: string;
}): Promise<Project> {
  const project = await getProjectForUser(args.projectId, args.userId);
  if (project.orgId === args.targetOrgId) return project;
  const db = getDb();
  const [updated] = await db
    .update(projects)
    .set({ orgId: args.targetOrgId, updatedAt: new Date() })
    .where(eq(projects.id, args.projectId))
    .returning();
  if (!updated) throw new Error('project move returned no row');
  return updated;
}
