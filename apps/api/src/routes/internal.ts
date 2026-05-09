import { Hono } from 'hono';

import { env } from '../env.js';
import { getDeployment, getDeploymentBundle } from '../services/deployments.js';
import { getPlainEnvForProject } from '../services/project-env.js';

/**
 * Internal endpoints — only the runtime host calls these, authenticated via
 * BRIVEN_RUNTIME_SHARED_SECRET. Never exposed to the public dashboard or
 * the customer SDK.
 */
export const internalRouter = new Hono();

internalRouter.use('/v1/internal/*', async (c, next) => {
  const expected = env.BRIVEN_RUNTIME_SHARED_SECRET;
  if (!expected) return c.json({ code: 'not_configured', message: 'runtime secret missing' }, 503);
  const auth = c.req.header('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
  if (token !== expected) return c.json({ code: 'unauthorized' }, 401);
  await next();
  return;
});

internalRouter.get('/v1/internal/deployments/:projectId/:deploymentId/bundle', async (c) => {
  // The projectId is included in the path so the runtime can verify the
  // deployment belongs to the project it thinks it does — defense in depth
  // against a runtime bug that could otherwise serve cross-project code.
  const projectId = c.req.param('projectId');
  const deploymentId = c.req.param('deploymentId');

  const deployment = await getDeployment(projectId, deploymentId);
  const bundle = await getDeploymentBundle(deploymentId);
  return c.json({
    deploymentId: deployment.id,
    projectId: deployment.projectId,
    functionNames: (deployment.functionNames as string[] | null) ?? [],
    bundle: bundle ?? {},
  });
});

/**
 * Decrypted env vars for a project — consumed by the runtime when spawning
 * an isolate. Body is a flat `{ KEY: "value", ... }` object. The shared
 * secret middleware above is the only auth; never expose this on a path
 * the dashboard or SDK can reach.
 */
internalRouter.get('/v1/internal/projects/:projectId/env', async (c) => {
  const projectId = c.req.param('projectId');
  const values = await getPlainEnvForProject(projectId);
  return c.json(values);
});
