import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Build identity helpers — shared across apps/api, apps/realtime,
 * apps/runtime so every service answers /info identically. The resolver
 * chain is:
 *
 *   1. BRIVEN_BUILD_SHA / BRIVEN_BUILD_AT — passed as Dockerfile ARGs by
 *      scripts/deploy-kvm4.sh. Preferred source for the deploy script
 *      path.
 *   2. .git/HEAD inside the image — fallback for Dokploy auto-deploys
 *      which run `docker compose build` without --build-arg. Requires
 *      the .git dir to be in the build context (we removed it from
 *      .dockerignore for this reason).
 *   3. The string "dev" — final fallback for fresh local checkouts /
 *      tests / anything where neither source resolves.
 *
 * "dev" is also treated as "unset" when seen in the env var because
 * that's the ARG default in the Dockerfile — when Dokploy builds
 * without passing the build-arg, the runtime env resolves to the
 * literal string "dev", and we want the .git branch to fire then too.
 */

const DEV_SENTINEL = 'dev';

function envValue(name: string): string | null {
  const v = process.env[name]?.trim();
  return !v || v === DEV_SENTINEL ? null : v;
}

/**
 * Read the commit sha from .git/HEAD without shelling out to `git`.
 * Handles three layouts:
 *   1. detached HEAD             — HEAD contains the sha directly
 *   2. ref pointing at a loose   — .git/refs/heads/<name> exists
 *   3. ref pointing at a packed  — entry lives in .git/packed-refs
 *
 * Returns null on any I/O failure so the caller can fall back to "dev".
 */
export function resolveShaFromGit(gitDir: string): string | null {
  try {
    const head = readFileSync(resolve(gitDir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return /^[0-9a-f]{40}$/.test(head) ? head : null;
    const ref = head.slice(4).trim();
    try {
      const sha = readFileSync(resolve(gitDir, ref), 'utf8').trim();
      if (/^[0-9a-f]{40}$/.test(sha)) return sha;
    } catch {
      // loose ref missing — try packed-refs
    }
    const packed = readFileSync(resolve(gitDir, 'packed-refs'), 'utf8');
    for (const line of packed.split('\n')) {
      if (line.startsWith('#') || line.startsWith('^')) continue;
      const [sha, name] = line.split(' ');
      if (name === ref && sha && /^[0-9a-f]{40}$/.test(sha)) return sha;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build timestamp fallback — mtime of .git/HEAD inside the image. The
 * mtime is updated whenever HEAD moves (checkout / commit / fetch+reset),
 * so inside a freshly-built image it reflects when the docker build
 * copied the .git tree.
 */
export function resolveBuildAtFromGit(gitDir: string): string | null {
  try {
    const stat = statSync(resolve(gitDir, 'HEAD'));
    return new Date(stat.mtimeMs).toISOString();
  } catch {
    return null;
  }
}

export interface BuildIdentity {
  buildSha: string;
  buildAt: string;
}

/**
 * Resolve build identity for a service. Each app passes the path to
 * its repo root's .git directory (typically two levels up from the
 * runtime working dir — `apps/<name>` → `../../.git`).
 */
export function resolveBuildIdentity(repoRootGitDir: string): BuildIdentity {
  const buildSha = envValue('BRIVEN_BUILD_SHA') ?? resolveShaFromGit(repoRootGitDir) ?? DEV_SENTINEL;
  const buildAt =
    envValue('BRIVEN_BUILD_AT') ?? resolveBuildAtFromGit(repoRootGitDir) ?? DEV_SENTINEL;
  return { buildSha, buildAt };
}
