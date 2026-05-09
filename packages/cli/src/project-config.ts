import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Project-local config read from the CWD. The authoritative format per
 * CLAUDE.md §7.2 is `briven.config.ts`, but Phase 1 reads the simpler
 * `briven.json` so the CLI can ship before the TS loader exists. Any
 * `briven.config.ts` takes precedence once its parser lands.
 */
export const PROJECT_CONFIG_FILENAME = 'briven.json';

export interface ProjectConfig {
  name: string;
  projectId?: string;
  region?: string;
}

export async function readProjectConfig(
  cwd: string = process.cwd(),
): Promise<ProjectConfig | null> {
  try {
    const raw = await readFile(resolve(cwd, PROJECT_CONFIG_FILENAME), 'utf8');
    const parsed = JSON.parse(raw) as ProjectConfig;
    if (!parsed || typeof parsed.name !== 'string') return null;
    return parsed;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function writeProjectConfig(
  config: ProjectConfig,
  cwd: string = process.cwd(),
): Promise<string> {
  const path = resolve(cwd, PROJECT_CONFIG_FILENAME);
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}
