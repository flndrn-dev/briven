import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { apiCall } from './api-client.js';

export interface PullOpts {
  apiOrigin: string;
  bearer: string;
  projectId: string;
  cwd: string;
}

/**
 * Pulls the project's live schema from the api and writes it to disk as
 * briven/schema.ts in the caller's cwd. Also seeds briven/functions/
 * with a README pointing at the (future) `briven pull functions` command.
 */
export async function pullSchemaToDisk(opts: PullOpts): Promise<void> {
  const resp = await apiCall<{ schemaTs: string }>(
    `/v1/projects/${opts.projectId}/studio/schema-export`,
    {
      apiOrigin: opts.apiOrigin,
      bearer: opts.bearer,
    },
  );
  const dir = join(opts.cwd, 'briven');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'schema.ts'), resp.schemaTs);
  const fnDir = join(dir, 'functions');
  await mkdir(fnDir, { recursive: true });
  await writeFile(
    join(fnDir, 'README.md'),
    [
      '# your functions live on briven',
      '',
      'this directory is intentionally empty. your existing functions still serve traffic.',
      'a future `briven pull functions` will recover their source. for now, write new ones',
      'here — every .ts file in this directory becomes an invokable function.',
      '',
    ].join('\n'),
  );
}
