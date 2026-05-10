import { apiCall, ApiCallError } from '../api-client.js';
import { readCredentials } from '../config.js';
import { readProjectConfig } from '../project-config.js';
import { banner, blankLine, error as printError, step, success } from '../output.js';

interface InvokeResponse {
  ok: boolean;
  value?: unknown;
  code?: string;
  message?: string;
  durationMs?: number;
  deploymentId?: string;
  touchedTables?: string[];
}

interface Args {
  functionName: string | null;
  body: unknown;
  raw: boolean;
  bodyError: string | null;
}

function parse(argv: readonly string[]): Args {
  const out: Args = { functionName: null, body: null, raw: false, bodyError: null };
  let bodySources = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--body' && argv[i + 1]) {
      bodySources++;
      const raw = argv[++i]!;
      try {
        out.body = JSON.parse(raw);
      } catch {
        out.bodyError = `--body is not valid json: ${raw.slice(0, 60)}${raw.length > 60 ? '…' : ''}`;
      }
    } else if (arg === '--body-file' && argv[i + 1]) {
      bodySources++;
      out.bodyError = `__BODY_FILE__:${argv[++i]!}`; // marker; resolved async below
    } else if (arg === '--raw') {
      out.raw = true;
    } else if (arg === '--help' || arg === '-h') {
      out.functionName = '__HELP__';
    } else if (!arg.startsWith('--') && out.functionName === null) {
      out.functionName = arg;
    }
  }
  if (bodySources > 1 && !out.bodyError?.startsWith('__BODY_FILE__')) {
    // Only flag conflict if --body parsed; --body-file is handled below.
    out.bodyError = '--body and --body-file cannot be combined';
  }
  return out;
}

function printUsage(): void {
  banner('invoke');
  blankLine();
  step('usage: briven invoke <function-name> [--body <json>] [--body-file <path>] [--raw]');
  step('  --body <json>        inline JSON request body (default: null)');
  step('  --body-file <path>   read JSON body from a file');
  step('  --raw                print only the function return value (unwrapped)');
}

export async function runInvoke(argv: readonly string[]): Promise<number> {
  const args = parse(argv);

  if (args.functionName === '__HELP__') {
    printUsage();
    return 0;
  }
  if (!args.functionName) {
    printUsage();
    return 1;
  }

  // Resolve --body-file lazily so we don't import fs unless needed.
  if (args.bodyError?.startsWith('__BODY_FILE__:')) {
    const path = args.bodyError.slice('__BODY_FILE__:'.length);
    args.bodyError = null;
    try {
      const { readFile } = await import('node:fs/promises');
      const text = await readFile(path, 'utf8');
      args.body = JSON.parse(text);
    } catch (err) {
      printError(`could not read --body-file: ${err instanceof Error ? err.message : 'unknown'}`);
      return 1;
    }
  }
  if (args.bodyError) {
    printError(args.bodyError);
    return 1;
  }

  const local = await readProjectConfig();
  const file = await readCredentials();
  const targetId = local?.projectId ?? file.default;
  if (!targetId) {
    printError('no linked project found.');
    step('run: briven login --project <p_...> --key <brk_...>');
    return 1;
  }

  const cred = file.projects[targetId];
  if (!cred) {
    printError(`no credentials stored for ${targetId}`);
    step('run: briven login --project <id> --key <brk_...>');
    return 1;
  }

  banner('invoke');
  step(`project   ${targetId}`);
  step(`function  ${args.functionName}`);
  step(`origin    ${cred.apiOrigin}`);

  let res: InvokeResponse;
  try {
    res = await apiCall<InvokeResponse>(
      `/v1/projects/${targetId}/functions/${encodeURIComponent(args.functionName)}`,
      {
        apiOrigin: cred.apiOrigin,
        apiKey: cred.apiKey,
        method: 'POST',
        body: args.body ?? {},
      },
    );
  } catch (err) {
    blankLine();
    if (err instanceof ApiCallError) {
      printError(`${err.code} (${err.status}): ${err.message}`);
    } else {
      printError(err instanceof Error ? err.message : 'unknown error');
    }
    return 1;
  }

  blankLine();
  if (args.raw) {
    // Unwrapped: just the function's return value, raw JSON. Lets callers
    // pipe through jq without needing to peel `.value`.
    process.stdout.write(`${JSON.stringify(res.ok ? res.value : { code: res.code, message: res.message }, null, 2)}\n`);
    return res.ok ? 0 : 1;
  }

  if (res.ok) {
    if (typeof res.durationMs === 'number') step(`took      ${res.durationMs}ms`);
    if (res.touchedTables && res.touchedTables.length > 0) {
      step(`tables    ${res.touchedTables.join(', ')}`);
    }
    success('returned:');
    process.stdout.write(`${JSON.stringify(res.value, null, 2)}\n`);
    return 0;
  }

  printError(`${res.code ?? 'unknown_error'}: ${res.message ?? 'no message'}`);
  if (typeof res.durationMs === 'number') step(`took      ${res.durationMs}ms`);
  return 1;
}
