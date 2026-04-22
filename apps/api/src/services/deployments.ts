import { newId, NotFoundError } from '@briven/shared';
import { and, desc, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  deployments,
  type Deployment,
  type DeploymentStatus,
  type NewDeployment,
} from '../db/schema.js';

export interface CreateDeploymentInput {
  projectId: string;
  triggeredBy: string | null;
  apiKeyId: string | null;
  schemaDiffSummary?: Record<string, unknown>;
  schemaSnapshot?: Record<string, unknown>;
  functionCount?: number;
  functionNames?: readonly string[];
}

export async function createDeployment(input: CreateDeploymentInput): Promise<Deployment> {
  const row: NewDeployment = {
    id: newId('d'),
    projectId: input.projectId,
    triggeredBy: input.triggeredBy,
    apiKeyId: input.apiKeyId,
    status: 'pending',
    schemaDiffSummary: input.schemaDiffSummary ?? null,
    schemaSnapshot: input.schemaSnapshot ?? null,
    functionCount: input.functionCount != null ? String(input.functionCount) : null,
    functionNames: input.functionNames ? [...input.functionNames] : null,
  };
  const db = getDb();
  const [created] = await db.insert(deployments).values(row).returning();
  if (!created) throw new Error('deployment insert returned no row');
  return created;
}

/**
 * The most recent deployment eligible to serve invokes. Phase 1 scope:
 * any deployment other than `failed` or `cancelled` counts — there is no
 * runner yet that transitions pending→succeeded. Phase 2 tightens this to
 * `succeeded` only once the shard worker lands.
 */
export async function getCurrentDeployment(projectId: string): Promise<Deployment | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.projectId, projectId))
    .orderBy(desc(deployments.createdAt))
    .limit(1);
  if (!row) return null;
  if (row.status === 'failed' || row.status === 'cancelled') return null;
  return row;
}

/**
 * The most recent deployment whose schema snapshot is authoritative for the
 * project. "Authoritative" means `succeeded`, or — before any deployment has
 * ever succeeded — the most recent `pending`/`running` one. This mirrors
 * what a CLI needs to compute the next diff against.
 */
export async function getCurrentSchema(projectId: string): Promise<{
  deploymentId: string | null;
  snapshot: Record<string, unknown> | null;
}> {
  const db = getDb();
  const [succeeded] = await db
    .select({ id: deployments.id, snapshot: deployments.schemaSnapshot })
    .from(deployments)
    .where(and(eq(deployments.projectId, projectId), eq(deployments.status, 'succeeded')))
    .orderBy(desc(deployments.createdAt))
    .limit(1);
  if (succeeded) {
    return {
      deploymentId: succeeded.id,
      snapshot: (succeeded.snapshot as Record<string, unknown> | null) ?? null,
    };
  }
  return { deploymentId: null, snapshot: null };
}

export async function listDeploymentsForProject(
  projectId: string,
  limit = 50,
): Promise<Deployment[]> {
  const db = getDb();
  return db
    .select()
    .from(deployments)
    .where(eq(deployments.projectId, projectId))
    .orderBy(desc(deployments.createdAt))
    .limit(limit);
}

export async function getDeployment(
  projectId: string,
  deploymentId: string,
): Promise<Deployment> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(deployments)
    .where(and(eq(deployments.id, deploymentId), eq(deployments.projectId, projectId)))
    .limit(1);
  if (!row) throw new NotFoundError('deployment', deploymentId);
  return row;
}

export interface TransitionDeploymentInput {
  projectId: string;
  deploymentId: string;
  status: DeploymentStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export async function transitionDeployment(
  input: TransitionDeploymentInput,
): Promise<Deployment> {
  const existing = await getDeployment(input.projectId, input.deploymentId);
  const now = new Date();
  const patch: Partial<Deployment> = { status: input.status };
  if (input.status === 'running' && !existing.startedAt) patch.startedAt = now;
  if (input.status === 'succeeded' || input.status === 'failed' || input.status === 'cancelled') {
    patch.finishedAt = now;
    if (!existing.startedAt) patch.startedAt = now;
  }
  if (input.errorCode !== undefined) patch.errorCode = input.errorCode;
  if (input.errorMessage !== undefined) patch.errorMessage = input.errorMessage;

  const db = getDb();
  const [updated] = await db
    .update(deployments)
    .set(patch)
    .where(eq(deployments.id, input.deploymentId))
    .returning();
  if (!updated) throw new Error('deployment update returned no row');
  return updated;
}

export async function cancelPendingDeployment(
  projectId: string,
  deploymentId: string,
): Promise<Deployment> {
  const existing = await getDeployment(projectId, deploymentId);
  if (existing.status !== 'pending' && existing.status !== 'running') {
    return existing;
  }
  return transitionDeployment({
    projectId,
    deploymentId,
    status: 'cancelled',
  });
}
