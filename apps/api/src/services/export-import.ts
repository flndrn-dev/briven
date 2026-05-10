import { brivenError, NotFoundError } from '@briven/shared';
import { eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { deployments, projects } from '../db/schema.js';
import { getCurrentDeployment, getDeploymentBundle } from './deployments.js';

/**
 * Project export — schema + functions, bundled as a single JSON object.
 *
 * Phase 2 first slice. Data movement (pg_dump streaming) is a follow-up
 * gated on the data-plane shell-token path; this slice ships only what's
 * already in the meta-DB so it can land without touching the data plane.
 *
 * Wire format is `briven-export.v1.json`:
 *   {
 *     manifest: { version: 1, sourceProjectId, sourceDeploymentId, exportedAt }
 *     schema: SchemaSnapshot — the SchemaDef shape from @briven/schema
 *     functions: { [filename]: source } — keys are relative paths under briven/functions/
 *   }
 *
 * `briven import` POSTs this back into a target project's `/v1/projects/:id/deployments`.
 */

export const EXPORT_VERSION = 1 as const;

export interface ProjectExport {
  readonly manifest: {
    readonly version: typeof EXPORT_VERSION;
    readonly sourceProjectId: string;
    readonly sourceProjectName: string;
    readonly sourceDeploymentId: string;
    readonly exportedAt: string;
  };
  readonly schema: Record<string, unknown> | null;
  readonly functions: Readonly<Record<string, string>>;
}

export async function buildProjectExport(projectId: string): Promise<ProjectExport> {
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new NotFoundError('project', projectId);

  const current = await getCurrentDeployment(projectId);
  if (!current) {
    throw new brivenError(
      'no_deployment',
      'project has no eligible deployment to export — deploy at least once first',
      { status: 409 },
    );
  }

  const [snapshotRow] = await db
    .select({ schemaSnapshot: deployments.schemaSnapshot })
    .from(deployments)
    .where(eq(deployments.id, current.id))
    .limit(1);
  const bundle = (await getDeploymentBundle(current.id)) ?? {};

  return {
    manifest: {
      version: EXPORT_VERSION,
      sourceProjectId: project.id,
      sourceProjectName: project.name,
      sourceDeploymentId: current.id,
      exportedAt: new Date().toISOString(),
    },
    schema: (snapshotRow?.schemaSnapshot as Record<string, unknown> | null) ?? null,
    functions: bundle,
  };
}
