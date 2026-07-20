/**
 * Platform session helpers: OAuth user login, remote project list/create,
 * and minting per-project CLI keys. Shared by `briven connect`,
 * `briven projects`, and the interactive wizard.
 */

import { apiCall, ApiCallError } from './api-client.js';
import {
  readUserCredential,
  writeProjectCredential,
  writeUserCredential,
  type UserCredential,
} from './config.js';
import { runOAuth } from './oauth.js';
import { resolveOrigins, type Origins } from './origins.js';
import { banner, blankLine, error as printError, step, success } from './output.js';

export interface MeUser {
  id: string;
  email: string;
}

export interface RemoteProject {
  id: string;
  slug: string;
  name?: string;
  region: string;
  tier: string;
  orgName: string | null;
}

/** Normalize /v1/me — API returns a flat profile; tolerate a nested { user } shape. */
export function normalizeMe(body: unknown): MeUser {
  if (!body || typeof body !== 'object') {
    throw new Error('unexpected /v1/me response');
  }
  const rec = body as Record<string, unknown>;
  if (rec.user && typeof rec.user === 'object') {
    const u = rec.user as Record<string, unknown>;
    if (typeof u.id === 'string' && typeof u.email === 'string') {
      return { id: u.id, email: u.email };
    }
  }
  if (typeof rec.id === 'string' && typeof rec.email === 'string') {
    return { id: rec.id, email: rec.email };
  }
  throw new Error('unexpected /v1/me response (missing id/email)');
}

export async function fetchMe(apiOrigin: string, token: string): Promise<MeUser> {
  const body = await apiCall<unknown>('/v1/me', {
    apiOrigin,
    bearer: token,
  });
  return normalizeMe(body);
}

export async function listRemoteProjects(
  apiOrigin: string,
  token: string,
): Promise<RemoteProject[]> {
  const list = await apiCall<{ projects: RemoteProject[] }>('/v1/me/projects', {
    apiOrigin,
    bearer: token,
  });
  return list.projects;
}

/** One-time storage credentials returned by POST /v1/projects (standard setup). */
export interface ProjectStorageBootstrap {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export async function createRemoteProject(
  apiOrigin: string,
  token: string,
  input: { name: string; region?: string; slug?: string },
): Promise<{ id: string; slug: string; storage: ProjectStorageBootstrap | null }> {
  const created = await apiCall<{
    project: { id: string; slug: string };
    storage?: {
      endpoint: string;
      bucket: string;
      accessKey: string;
      secretKey: string;
    } | null;
  }>('/v1/projects', {
    apiOrigin,
    bearer: token,
    method: 'POST',
    body: {
      name: input.name,
      ...(input.region ? { region: input.region } : {}),
      ...(input.slug ? { slug: input.slug } : {}),
    },
  });
  const s = created.storage;
  const storage =
    s && s.endpoint && s.bucket && s.accessKey && s.secretKey
      ? {
          endpoint: s.endpoint,
          bucket: s.bucket,
          accessKey: s.accessKey,
          secretKey: s.secretKey,
        }
      : null;
  return { id: created.project.id, slug: created.project.slug, storage };
}

/**
 * Mint a project-scoped admin key and persist it so `briven deploy` / `dev`
 * work without pasting a dashboard key by hand.
 */
export async function mintAndStoreKey(
  apiOrigin: string,
  token: string,
  projectId: string,
  keyName = 'cli',
): Promise<{ suffix: string }> {
  const minted = await apiCall<{
    key: { id: string; suffix: string; createdAt: string };
    plaintext: string;
  }>(`/v1/projects/${projectId}/api-keys`, {
    apiOrigin,
    bearer: token,
    method: 'POST',
    body: { name: keyName, role: 'admin' },
  });
  await writeProjectCredential({
    projectId,
    apiKey: minted.plaintext,
    apiOrigin,
    suffix: minted.key.suffix,
    createdAt: minted.key.createdAt,
  });
  return { suffix: minted.key.suffix };
}

export interface EnsureSessionOptions {
  /** Force a fresh browser OAuth even if a token is already stored. */
  force?: boolean;
  /** Quiet: skip banners (for subcommands that already printed one). */
  quiet?: boolean;
  origins?: Origins;
}

/**
 * Ensure this machine has a platform user session (OAuth token).
 * Opens the browser when needed. Returns the stored user credential.
 */
export async function ensurePlatformSession(
  opts: EnsureSessionOptions = {},
): Promise<UserCredential> {
  const origins = opts.origins ?? resolveOrigins();
  const existing = await readUserCredential();

  if (existing && !opts.force) {
    try {
      await fetchMe(existing.apiOrigin, existing.token);
      return existing;
    } catch (err) {
      if (err instanceof ApiCallError && (err.status === 401 || err.status === 403)) {
        if (!opts.quiet) {
          step('saved session expired — re-authorizing…');
        }
      } else {
        throw err;
      }
    }
  }

  if (!opts.quiet) {
    banner('connect');
    blankLine();
    step('opening browser to authorize the cli…');
  }

  const { token, apiOrigin } = await runOAuth({
    apiOrigin: origins.apiOrigin,
    dashboardOrigin: origins.dashboardOrigin,
  });

  const me = await fetchMe(apiOrigin, token);
  const user: UserCredential = {
    token,
    userId: me.id,
    apiOrigin,
    savedAt: new Date().toISOString(),
  };
  await writeUserCredential(user);
  if (!opts.quiet) {
    success(`signed in as ${me.email}`);
    blankLine();
  }
  return user;
}

/** Pretty-print a remote project list (for CLI stdout). */
export function printRemoteProjects(projects: RemoteProject[]): void {
  if (projects.length === 0) {
    step('no projects on your account yet.');
    step('run: briven projects create --name my-app');
    return;
  }
  step(`${projects.length} project${projects.length === 1 ? '' : 's'} on your account:`);
  for (const p of projects) {
    const org = p.orgName ?? '—';
    const label = p.name && p.name !== p.slug ? `${p.slug} (${p.name})` : p.slug;
    step(`  ${p.id}  ·  ${org}/${label}  ·  ${p.region}  ·  ${p.tier}`);
  }
}

export function printSessionExpiredHint(): void {
  printError('platform session missing or expired.');
  step('run: briven connect');
}
