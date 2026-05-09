import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Where we cache the user's CLI credentials. Follows XDG when set,
 * otherwise `~/.config/briven/credentials.json`.
 *
 * File format is deliberately small — each entry is (projectId, apiKey,
 * apiOrigin). A future `briven login` that issues per-user personal
 * access tokens will extend this schema.
 */
function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'briven');
}

export function credentialsPath(): string {
  return join(configDir(), 'credentials.json');
}

export interface ProjectCredential {
  projectId: string;
  apiKey: string;
  apiOrigin: string;
  // Last 4 chars of the key, for display.
  suffix: string;
  createdAt: string;
}

export interface CredentialsFile {
  version: 1;
  default?: string; // projectId
  projects: Record<string, ProjectCredential>;
}

const EMPTY: CredentialsFile = { version: 1, projects: {} };

export async function readCredentials(): Promise<CredentialsFile> {
  try {
    const raw = await readFile(credentialsPath(), 'utf8');
    const parsed = JSON.parse(raw) as CredentialsFile;
    if (!parsed || parsed.version !== 1 || typeof parsed.projects !== 'object') {
      return EMPTY;
    }
    return parsed;
  } catch (err) {
    if (isNotFound(err)) return EMPTY;
    throw err;
  }
}

export async function writeCredentials(file: CredentialsFile): Promise<void> {
  const path = credentialsPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(file, null, 2), { mode: 0o600 });
}

export async function clearCredentials(): Promise<void> {
  try {
    await rm(credentialsPath());
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}
