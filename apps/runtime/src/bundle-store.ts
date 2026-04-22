import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { env } from './env.js';
import type { Bundle } from './types.js';

interface BundleResponse {
  deploymentId: string;
  projectId: string;
  functionNames: string[];
  bundle: Record<string, string>;
}

/**
 * In-memory cache keyed by deploymentId. A new deployment for the same
 * project gets a new id, so cache lookup is always either a hit (same
 * deployment) or a miss (new deployment), never stale.
 */
const cache = new Map<string, Bundle>();

/**
 * Fetch the deployment's bundle from apps/api over the swarm overlay
 * network, write each function file under
 *   <BRIVEN_RUNTIME_BUNDLE_DIR>/<projectId>/<deploymentId>/functions/<name>.ts
 * and return a Bundle handle the executor can read from disk.
 */
export async function loadDeployment(
  projectId: string,
  deploymentId: string,
): Promise<Bundle | null> {
  const cached = cache.get(deploymentId);
  if (cached) return cached;

  const headers: Record<string, string> = { accept: 'application/json' };
  if (env.BRIVEN_RUNTIME_SHARED_SECRET) {
    headers['authorization'] = `Bearer ${env.BRIVEN_RUNTIME_SHARED_SECRET}`;
  }

  const url = `${env.BRIVEN_API_INTERNAL_URL}/v1/internal/deployments/${projectId}/${deploymentId}/bundle`;
  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`bundle fetch failed: ${res.status}`);
  }

  const payload = (await res.json()) as BundleResponse;
  const dir = resolve(env.BRIVEN_RUNTIME_BUNDLE_DIR, projectId, deploymentId);

  // Wipe any prior on-disk content for this deployment (idempotent restart).
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  for (const [relPath, source] of Object.entries(payload.bundle)) {
    if (relPath.includes('..') || relPath.startsWith('/')) {
      // Refuse path traversal — the api should never send these but the
      // runtime is the last line of defense.
      continue;
    }
    const target = resolve(dir, 'functions', relPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source, 'utf8');
  }

  const bundle: Bundle = {
    projectId,
    deploymentId,
    functionNames: payload.functionNames.map(stripExt),
    directory: dir,
  };
  cache.set(deploymentId, bundle);
  return bundle;
}

function stripExt(name: string): string {
  return name.endsWith('.ts') ? name.slice(0, -'.ts'.length) : name;
}
