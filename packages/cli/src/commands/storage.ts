/**
 * `briven storage` — project MinIO / S3 object storage (Convex-style DX).
 *
 * Creates (or reuses) the project's private bucket and can mint a bucket-scoped
 * S3 key you can paste into .env or any S3 client.
 *
 * Auth: project CLI key from `briven setup` / `briven projects use` (brk_…).
 */

import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ApiCallError, apiCall } from '../api-client.js';
import { readCredentials } from '../config.js';
import { readProjectConfig } from '../project-config.js';
import { banner, blankLine, error as printError, step, success } from '../output.js';

interface CreatedStorageKey {
  record: {
    id: string;
    name: string;
    accessKeyId: string;
    suffix: string;
    bucket: string;
  };
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

interface ListResponse {
  keys: Array<{
    id: string;
    name: string;
    accessKeyId: string;
    suffix: string;
    bucket: string;
    enabled: boolean;
    revokedAt: string | null;
  }>;
  endpoint: string;
}

function printUsage(): void {
  banner('storage');
  blankLine();
  step('usage:');
  step('  briven storage setup [--name <label>] [--write-env] [--env-file .env.local]');
  step('      ensure MinIO bucket for this project + mint S3 key (secret once)');
  step('  briven storage status                 list keys + endpoint (no secrets)');
  blankLine();
  step('needs a linked project (same as Convex after npx convex dev):');
  step('  briven setup --project p_…');
  step('  # or: briven projects use p_… --link');
  blankLine();
  step('then:');
  step('  briven storage setup --write-env');
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === name && argv[i + 1]) return argv[i + 1];
    if (arg?.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(name);
}

async function resolveProjectCred(projectFlag?: string): Promise<{
  projectId: string;
  apiKey: string;
  apiOrigin: string;
}> {
  const local = await readProjectConfig();
  const creds = await readCredentials();
  const projectId =
    projectFlag ??
    local?.projectId ??
    creds.default ??
    Object.keys(creds.projects)[0];
  if (!projectId) {
    throw new Error(
      'no project linked. run: briven setup --project p_…   (or briven projects use p_… --link)',
    );
  }
  const cred = creds.projects[projectId];
  if (!cred?.apiKey) {
    throw new Error(
      `no CLI key for ${projectId}. run: briven projects use ${projectId}`,
    );
  }
  return {
    projectId,
    apiKey: cred.apiKey,
    apiOrigin: cred.apiOrigin || 'https://api.briven.tech',
  };
}

export async function runStorage(argv: readonly string[]): Promise<number> {
  const [sub, ...rest] = argv;

  if (!sub || sub === '--help' || sub === '-h' || sub === 'help') {
    printUsage();
    return sub ? 0 : 1;
  }

  if (sub === 'status') {
    return storageStatus(rest);
  }
  if (sub === 'setup') {
    return storageSetup(rest);
  }

  printError(`unknown subcommand: ${sub}`);
  step("run 'briven storage --help'");
  return 1;
}

async function storageStatus(argv: readonly string[]): Promise<number> {
  const projectFlag = flagValue(argv, '--project');
  try {
    const { projectId, apiKey, apiOrigin } = await resolveProjectCred(projectFlag);
    banner('storage status');
    step(`project  ${projectId}`);
    step(`api      ${apiOrigin}`);

    const body = await apiCall<ListResponse>(`/v1/projects/${projectId}/storage-keys`, {
      apiOrigin,
      apiKey,
    });
    blankLine();
    step(`endpoint ${body.endpoint || '(not set)'}`);
    step(`bucket   proj-${projectId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 58)}`);
    blankLine();
    if (body.keys.length === 0) {
      step('no storage keys yet — run: briven storage setup');
      return 0;
    }
    for (const k of body.keys) {
      const state = k.revokedAt ? 'revoked' : k.enabled ? 'active' : 'disabled';
      step(`  ${k.name}  ${k.accessKeyId.slice(0, 8)}…  bucket=${k.bucket}  ${state}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof ApiCallError) {
      printError(`${err.code}: ${err.message}`);
      return 1;
    }
    printError(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

async function storageSetup(argv: readonly string[]): Promise<number> {
  const projectFlag = flagValue(argv, '--project');
  let name = flagValue(argv, '--name') ?? 'default';
  const writeEnv = hasFlag(argv, '--write-env');
  const envFile = flagValue(argv, '--env-file') ?? '.env.local';

  try {
    const { projectId, apiKey, apiOrigin } = await resolveProjectCred(projectFlag);
    banner('storage setup');
    step(`project  ${projectId}`);
    step(`api      ${apiOrigin}`);
    step('ensuring MinIO bucket + minting bucket-scoped S3 key…');

    // Always mint a key so we have a full secret (required for .env.local).
    // If the requested name is taken, pick a unique label.
    const listed = await apiCall<ListResponse>(`/v1/projects/${projectId}/storage-keys`, {
      apiOrigin,
      apiKey,
    }).catch(() => ({ keys: [] as ListResponse['keys'], endpoint: '' }));
    const used = new Set(
      listed.keys.filter((k) => k.enabled && !k.revokedAt).map((k) => k.name),
    );
    if (used.has(name)) {
      name = `${name}-${Date.now().toString(36).slice(-5)}`;
      step(`key name already used — minting as "${name}"`);
    }

    const created = await apiCall<CreatedStorageKey>(
      `/v1/projects/${projectId}/storage-keys`,
      {
        apiOrigin,
        apiKey,
        method: 'POST',
        body: { name },
      },
    );

    blankLine();
    success('S3 bucket + key ready');
    step(`bucket    ${created.bucket}`);
    step(`endpoint  ${created.endpoint}`);
    step(`accessKey ${created.accessKey}`);
    step(`secretKey ${created.secretKey}`);
    step('(secret shown once — also written to env when --write-env)');
    blankLine();
    step('S3-compatible env (for apps / AWS SDK / rclone):');
    step(`  AWS_ENDPOINT_URL=${created.endpoint}`);
    step(`  AWS_ACCESS_KEY_ID=${created.accessKey}`);
    step(`  AWS_SECRET_ACCESS_KEY=${created.secretKey}`);
    step(`  AWS_REGION=auto`);
    step(`  S3_BUCKET=${created.bucket}`);

    // Default: write env when called from setup, or when --write-env is set.
    // `briven setup` always passes --write-env so the folder is fully wired.
    if (writeEnv) {
      const path = resolve(process.cwd(), envFile);
      const block = [
        '',
        '# Briven project storage (MinIO S3) — from briven storage setup',
        `BRIVEN_STORAGE_ENDPOINT=${created.endpoint}`,
        `BRIVEN_STORAGE_BUCKET=${created.bucket}`,
        `BRIVEN_STORAGE_ACCESS_KEY=${created.accessKey}`,
        `BRIVEN_STORAGE_SECRET_KEY=${created.secretKey}`,
        `AWS_ENDPOINT_URL=${created.endpoint}`,
        `AWS_ACCESS_KEY_ID=${created.accessKey}`,
        `AWS_SECRET_ACCESS_KEY=${created.secretKey}`,
        `S3_BUCKET=${created.bucket}`,
        '',
      ].join('\n');
      try {
        const existing = await readFile(path, 'utf8').catch(() => '');
        if (existing.includes('BRIVEN_STORAGE_BUCKET=')) {
          await appendFile(
            path,
            `\n# --- briven storage setup ${new Date().toISOString()} (appended; review duplicates) ---\n${block}`,
          );
        } else {
          await writeFile(path, existing + block, { mode: 0o600 });
        }
        success(`wrote credentials to ${envFile}`);
      } catch (e) {
        printError(`could not write ${envFile}: ${e instanceof Error ? e.message : e}`);
        return 1;
      }
    }

    return 0;
  } catch (err) {
    if (err instanceof ApiCallError) {
      printError(`${err.code}: ${err.message}`);
      if (err.code === 'storage_not_configured' || err.status === 503) {
        step('platform MinIO is not configured on the API (operator: BRIVEN_MINIO_*).');
      }
      if (err.status === 401 || err.status === 403) {
        step('re-link the project: briven projects use <p_…> --link');
      }
      return 1;
    }
    printError(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
