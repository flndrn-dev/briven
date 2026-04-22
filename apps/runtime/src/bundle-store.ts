import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { env } from './env.js';
import type { Bundle } from './types.js';

/**
 * Layout on disk:
 *   <BRIVEN_RUNTIME_BUNDLE_DIR>/
 *     <projectId>/
 *       current -> <deploymentId>    (symlink)
 *       <deploymentId>/
 *         functions/<name>.ts
 *         schema.json
 *
 * The control plane writes bundles; the runtime only reads them. Phase 1
 * skips the write path entirely — the operator hand-copies files. The
 * bundle upload endpoint on apps/api is a later milestone.
 */
export async function loadCurrentBundle(projectId: string): Promise<Bundle | null> {
  const projectDir = resolve(env.BRIVEN_RUNTIME_BUNDLE_DIR, projectId);
  const currentLink = resolve(projectDir, 'current');

  let deploymentId: string;
  try {
    const linkStat = await stat(currentLink);
    if (!linkStat.isDirectory()) return null;
    // If it's a symlink Bun/Node follows it via stat; we want the target name.
    // Keep it simple: read the directory listing and find the most recent
    // non-`current` subdir as a fallback.
    const entries = await readdir(projectDir, { withFileTypes: true });
    const candidates = entries
      .filter((e) => e.isDirectory() && e.name !== 'current')
      .map((e) => e.name);
    if (candidates.length === 0) return null;
    candidates.sort().reverse();
    deploymentId = candidates[0]!;
  } catch {
    return null;
  }

  const deploymentDir = resolve(projectDir, deploymentId);
  const functionsDir = resolve(deploymentDir, 'functions');
  const functionNames: string[] = [];
  try {
    const entries = await readdir(functionsDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
        functionNames.push(e.name.slice(0, -'.ts'.length));
      }
    }
  } catch {
    // no functions dir — a schema-only deploy is valid
  }

  return {
    projectId,
    deploymentId,
    functionNames,
    directory: deploymentDir,
  };
}
