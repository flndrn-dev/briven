import { randomBytes } from 'node:crypto';

import { newId, NotFoundError, ForbiddenError, ValidationError } from '@briven/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { provisionProjectSchema, schemaNameFor } from '../db/data-plane.js';
import { projects, projectMembers, type Project, type NewProject } from '../db/schema.js';
import { log } from '../lib/logger.js';

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
  ownerId: string;
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

  const projectId = newId('p');
  const row: NewProject = {
    id: projectId,
    slug,
    name: input.name,
    ownerId: input.ownerId,
    region: input.region ?? 'eu-west-1',
    tier: 'free',
    dataSchemaName: schemaNameFor(projectId),
  };

  const db = getDb();
  const [created] = await db.insert(projects).values(row).returning();
  if (!created) throw new Error('project insert returned no row');

  // Owner is automatically a member with role=owner. Phase 3 RBAC fleshes
  // out the other roles; the row exists from day one for consistency.
  await db.insert(projectMembers).values({
    projectId: created.id,
    userId: input.ownerId,
    role: 'owner',
  });

  // Provision the data-plane schema. If this fails we log and let the row
  // stand — the deploy worker will retry the schema creation before applying
  // any DDL, so a transient outage here doesn't strand the project.
  try {
    await provisionProjectSchema(created.id);
  } catch (err) {
    log.error('project_schema_provision_failed', {
      projectId: created.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return created;
}

export async function listProjectsForUser(userId: string): Promise<Project[]> {
  const db = getDb();
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.ownerId, userId), isNull(projects.deletedAt)))
    .orderBy(desc(projects.createdAt));
}

export async function getProjectForUser(projectId: string, userId: string): Promise<Project> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError('project', projectId);
  if (row.ownerId !== userId) throw new ForbiddenError('you do not own this project');
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
