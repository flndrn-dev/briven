import { apiCall, ApiCallError } from '../api-client.js';
import { readCredentials, writeCredentials } from '../config.js';
import { banner, blankLine, error as printError, step, success } from '../output.js';

const DEFAULT_API_ORIGIN = 'https://api.briven.cloud';

interface ParsedArgs {
  projectId?: string;
  apiKey?: string;
  apiOrigin: string;
  setDefault: boolean;
}

function parse(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { apiOrigin: DEFAULT_API_ORIGIN, setDefault: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project' && argv[i + 1]) {
      out.projectId = argv[++i];
    } else if (arg === '--key' && argv[i + 1]) {
      out.apiKey = argv[++i];
    } else if (arg === '--api-origin' && argv[i + 1]) {
      out.apiOrigin = argv[++i]!;
    } else if (arg === '--no-default') {
      out.setDefault = false;
    }
  }
  if (process.env.BRIVEN_API_ORIGIN) out.apiOrigin = process.env.BRIVEN_API_ORIGIN;
  return out;
}

export async function runLogin(argv: readonly string[]): Promise<number> {
  const args = parse(argv);

  if (!args.projectId || !args.apiKey) {
    banner('login');
    blankLine();
    step('usage: briven login --project <p_...> --key <brk_...>');
    step('create a key from the dashboard: /dashboard/projects/<id>/keys');
    return 1;
  }

  if (!args.apiKey.startsWith('brk_')) {
    printError('api key must start with brk_');
    return 1;
  }

  banner('login');
  step(`verifying key against ${args.apiOrigin}`);

  try {
    await apiCall(`/v1/projects/${args.projectId}/info`, {
      apiOrigin: args.apiOrigin,
      apiKey: args.apiKey,
    });
  } catch (err) {
    if (err instanceof ApiCallError) {
      printError(`server rejected the credentials: ${err.code}`);
      return 1;
    }
    printError(err instanceof Error ? err.message : 'unknown error');
    return 1;
  }

  const suffix = args.apiKey.slice(-4);
  const file = await readCredentials();
  file.projects[args.projectId] = {
    projectId: args.projectId,
    apiKey: args.apiKey,
    apiOrigin: args.apiOrigin,
    suffix,
    createdAt: new Date().toISOString(),
  };
  if (args.setDefault) file.default = args.projectId;
  await writeCredentials(file);

  success(`credentials saved for ${args.projectId}`);
  return 0;
}
