import { diff, type Change, type SchemaDef } from '@briven/schema';

import { apiCall, ApiCallError } from '../api-client.js';
import { discoverFunctions, loadProjectSchema } from '../bundler.js';
import { readCredentials } from '../config.js';
import { readProjectConfig } from '../project-config.js';
import { banner, blankLine, error as printError, step, success } from '../output.js';

interface DeploymentResponse {
  deployment: {
    id: string;
    status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    createdAt: string;
  };
}

interface CurrentSchemaResponse {
  deploymentId: string | null;
  snapshot: SchemaDef | null;
}

interface Args {
  confirmDestructive: boolean;
  dryRun: boolean;
}

function parse(argv: readonly string[]): Args {
  const out: Args = { confirmDestructive: false, dryRun: false };
  for (const arg of argv) {
    if (arg === '--confirm-destructive') out.confirmDestructive = true;
    else if (arg === '--dry-run') out.dryRun = true;
  }
  return out;
}

export async function runDeploy(argv: readonly string[]): Promise<number> {
  const args = parse(argv);
  const local = await readProjectConfig();
  if (!local) {
    printError('no briven.json in this directory.');
    step('run: briven init');
    return 1;
  }

  const targetId = local.projectId;
  if (!targetId) {
    printError('briven.json has no projectId — link this directory first.');
    step('run: briven login --project <id> --key <brk_...>');
    return 1;
  }

  const creds = await readCredentials();
  const cred = creds.projects[targetId];
  if (!cred) {
    printError(`no stored credentials for ${targetId}.`);
    step('run: briven login --project <id> --key <brk_...>');
    return 1;
  }

  banner('deploy');
  step(`project     ${targetId}`);
  step(`origin      ${cred.apiOrigin}`);

  step('loading briven/schema.ts');
  let nextSchema: SchemaDef | null;
  try {
    nextSchema = await loadProjectSchema(process.cwd());
  } catch (err) {
    printError(err instanceof Error ? err.message : 'failed to load schema');
    return 1;
  }
  if (!nextSchema) {
    printError('briven/schema.ts not found — run `briven init` first.');
    return 1;
  }

  step('discovering briven/functions');
  const functions = await discoverFunctions(process.cwd());

  step('fetching current deployed schema');
  let current: CurrentSchemaResponse;
  try {
    current = await apiCall<CurrentSchemaResponse>(
      `/v1/projects/${targetId}/schema/current`,
      { apiOrigin: cred.apiOrigin, apiKey: cred.apiKey },
    );
  } catch (err) {
    if (err instanceof ApiCallError) {
      printError(`server rejected: ${err.code} (${err.status})`);
    } else {
      printError(err instanceof Error ? err.message : 'unknown error');
    }
    return 1;
  }

  const result = diff(current.snapshot, nextSchema);
  blankLine();
  if (result.changes.length === 0) {
    step('no schema changes');
  } else {
    step(`schema changes (${result.changes.length}):`);
    for (const c of result.changes) {
      step(`  ${formatChange(c)}`);
    }
  }
  step(`functions: ${functions.count}`);

  if (result.destructive && !args.confirmDestructive) {
    blankLine();
    printError(
      'destructive changes detected (drop table / drop column). Re-run with --confirm-destructive.',
    );
    return 1;
  }

  if (args.dryRun) {
    blankLine();
    success('dry run — nothing sent to the server');
    return 0;
  }

  const summary = summarise(result.changes);

  step('creating deployment...');
  try {
    const res = await apiCall<DeploymentResponse>(
      `/v1/projects/${targetId}/deployments`,
      {
        method: 'POST',
        apiOrigin: cred.apiOrigin,
        apiKey: cred.apiKey,
        body: {
          schemaDiffSummary: summary,
          schemaSnapshot: nextSchema,
          functionCount: functions.count,
          functionNames: functions.names,
        },
      },
    );
    blankLine();
    success(`deployment ${res.deployment.id} · ${res.deployment.status}`);
    return 0;
  } catch (err) {
    if (err instanceof ApiCallError) {
      printError(`deploy failed: ${err.code} (${err.status})`);
    } else {
      printError(err instanceof Error ? err.message : 'unknown error');
    }
    return 1;
  }
}

function formatChange(c: Change): string {
  switch (c.kind) {
    case 'create_table':
      return `+ table ${c.table}`;
    case 'drop_table':
      return `- table ${c.table}`;
    case 'add_column':
      return `+ ${c.table}.${c.column}`;
    case 'drop_column':
      return `- ${c.table}.${c.column}`;
  }
}

function summarise(changes: readonly Change[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of changes) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  return counts;
}
