import { writeFile } from 'node:fs/promises';

import { apiCall, ApiCallError } from '../api-client.js';
import { readCredentials } from '../config.js';
import { readProjectConfig } from '../project-config.js';
import { banner, blankLine, error as printError, step, success } from '../output.js';

/**
 * `briven ai <subcommand>` — schema | function | explain.
 *
 * Proxies to the same three api endpoints the dashboard hits. Same
 * not_configured semantics: when the api host hasn't wired
 * BRIVEN_OLLAMA_URL the cli prints a clear "AI assistant offline"
 * message instead of an opaque http error.
 *
 * usage:
 *   briven ai schema "a blog with users, posts, comments"
 *   briven ai schema "a blog…" --out briven/schema.ts
 *   briven ai function "list posts from the last 24h" --with-schema
 *   briven ai explain --file briven/functions/listPosts.ts
 *
 * shared flags:
 *   --out <path>        write the result to <path> instead of stdout
 *   --raw               emit raw response (no banner / meta footer)
 */

const SUBCOMMANDS = ['schema', 'function', 'explain'] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

export async function runAi(argv: readonly string[]): Promise<number> {
  const [sub, ...rest] = argv;

  if (!sub || sub === '--help' || sub === '-h' || sub === 'help') {
    printHelp();
    return 0;
  }

  if (!SUBCOMMANDS.includes(sub as Subcommand)) {
    printError(`unknown ai subcommand '${sub}'`);
    printHelp();
    return 1;
  }

  const subcommand = sub as Subcommand;
  const flags = parseFlags(rest);
  if (flags.help) {
    printHelp(subcommand);
    return 0;
  }

  // Resolve the project + api credentials. Same shape as `briven invoke`:
  // briven.json gives the projectId, ~/.config/briven/credentials.json
  // gives the api origin + per-project key.
  const local = await readProjectConfig();
  if (!local?.projectId) {
    printError('not linked to a project. run `briven link` first.');
    return 1;
  }
  const creds = await readCredentials();
  const cred = creds.projects[local.projectId];
  if (!cred) {
    printError(
      `no api key on this machine for ${local.projectId}. run \`briven login\` or paste a brk_ key.`,
    );
    return 1;
  }

  // Read the prompt. For schema/function the prompt is positional; for
  // explain the input is a code file (--file <path>) or a positional
  // path. --perspective is explain-only.
  let body: Record<string, unknown> = {};
  let routeSuffix: string;
  if (subcommand === 'schema') {
    if (!flags.positional) {
      printError('briven ai schema requires a prompt argument');
      return 1;
    }
    routeSuffix = 'generate-schema';
    body = { prompt: flags.positional };
  } else if (subcommand === 'function') {
    if (!flags.positional) {
      printError('briven ai function requires a prompt argument');
      return 1;
    }
    routeSuffix = 'generate-function';
    body = { prompt: flags.positional };
    if (flags.withSchema) {
      const schemaCtx = await fetchSchemaContext(cred.apiOrigin, cred.apiKey, local.projectId);
      if (schemaCtx) body.schemaContext = schemaCtx;
    }
  } else {
    // explain
    const code = flags.file ? await readFileOrFail(flags.file) : flags.positional;
    if (!code) {
      printError('briven ai explain requires --file <path> or an inline snippet');
      return 1;
    }
    routeSuffix = 'explain-code';
    body = { code };
    if (flags.perspective) body.perspective = flags.perspective;
  }

  if (!flags.raw) {
    banner(`ai ${subcommand}`);
    blankLine();
    step(`forwarding to ${cred.apiOrigin}${flags.stream ? ' (streaming)' : ''}`);
  }

  // Streaming path — write tokens to stdout as they arrive. Caller can
  // pipe this into a file with `> briven/schema.ts`. `--out` is still
  // honoured: we accumulate the stream and write at the end so the
  // file isn't half-written if the stream errors.
  if (flags.stream) {
    return runStreaming({
      apiOrigin: cred.apiOrigin,
      apiKey: cred.apiKey,
      projectId: local.projectId,
      routeSuffix,
      body,
      flags,
      isRaw: flags.raw,
    });
  }

  let response: unknown;
  try {
    response = await apiCall<unknown>(
      `/v1/projects/${local.projectId}/ai/${routeSuffix}`,
      {
        apiOrigin: cred.apiOrigin,
        apiKey: cred.apiKey,
        method: 'POST',
        body,
      },
    );
  } catch (err) {
    if (err instanceof ApiCallError) {
      if (err.code === 'not_configured') {
        printError(
          `AI assistant offline on this deployment (operator: set BRIVEN_OLLAMA_URL on the api host).`,
        );
        return 2;
      }
      if (err.code === 'validation_failed') {
        printError(`validation failed: ${err.message}`);
        return 1;
      }
      printError(`api error (${err.status} ${err.code}): ${err.message}`);
      return 1;
    }
    printError(err instanceof Error ? err.message : 'request failed');
    return 1;
  }

  // Each subcommand returns a different content field — collapse them.
  const result = response as {
    schema?: string;
    function?: string;
    explanation?: string;
    model?: string;
    elapsedMs?: number;
  };
  const content =
    result.schema ?? result.function ?? result.explanation ?? '';

  if (flags.out) {
    await writeFile(flags.out, content + '\n', 'utf8');
    if (!flags.raw) {
      success(`wrote ${content.length} chars to ${flags.out}`);
      if (result.model) {
        step(`generated by ${result.model} in ${result.elapsedMs ?? 0}ms`);
      }
    }
    return 0;
  }

  process.stdout.write(content + '\n');
  if (!flags.raw && result.model) {
    blankLine();
    step(`generated by ${result.model} in ${result.elapsedMs ?? 0}ms`);
  }
  return 0;
}

interface Flags {
  positional: string | null;
  out: string | null;
  file: string | null;
  perspective: string | null;
  withSchema: boolean;
  raw: boolean;
  stream: boolean;
  help: boolean;
}

function parseFlags(argv: readonly string[]): Flags {
  const out: Flags = {
    positional: null,
    out: null,
    file: null,
    perspective: null,
    withSchema: false,
    raw: false,
    stream: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--out' && argv[i + 1]) {
      out.out = argv[++i]!;
    } else if (arg === '--file' && argv[i + 1]) {
      out.file = argv[++i]!;
    } else if (arg === '--perspective' && argv[i + 1]) {
      out.perspective = argv[++i]!;
    } else if (arg === '--with-schema') {
      out.withSchema = true;
    } else if (arg === '--raw') {
      out.raw = true;
    } else if (arg === '--stream') {
      out.stream = true;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else if (!arg.startsWith('--') && out.positional === null) {
      out.positional = arg;
    }
  }
  return out;
}

/**
 * Stream-mode path. POSTs to the /stream variant of the route, reads
 * the response body as a UTF-8 stream, parses SSE frames, writes each
 * token chunk to stdout in real time. Honors --out by accumulating the
 * stream and writing the file at the end (so a stream error doesn't
 * leave a half-written file on disk).
 */
async function runStreaming(args: {
  apiOrigin: string;
  apiKey: string;
  projectId: string;
  routeSuffix: string;
  body: Record<string, unknown>;
  flags: Flags;
  isRaw: boolean;
}): Promise<number> {
  const url = `${args.apiOrigin}/v1/projects/${args.projectId}/ai/${args.routeSuffix}/stream`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${args.apiKey}`,
        accept: 'text/event-stream',
      },
      body: JSON.stringify(args.body),
    });
  } catch (err) {
    printError(err instanceof Error ? err.message : 'network error');
    return 1;
  }

  if (res.status === 503) {
    printError('AI assistant offline on this deployment (operator: set BRIVEN_OLLAMA_URL).');
    return 2;
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    printError(`api error (${res.status}): ${text}`);
    return 1;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const parsed = parseSseFrame(frame);
      if (parsed.event === 'token' && parsed.data) {
        const chunk = unescapeJsonChunk(parsed.data);
        accumulated += chunk;
        // Stream to stdout when there's no --out target so the user
        // sees tokens land in their terminal as the model produces them.
        if (!args.flags.out) process.stdout.write(chunk);
      } else if (parsed.event === 'error') {
        if (!args.flags.out) process.stdout.write('\n');
        printError(parsed.data || 'stream error');
        return 1;
      }
      // 'done' just ends the stream — the reader will see EOF next.
    }
  }

  if (args.flags.out) {
    await writeFile(args.flags.out, accumulated + '\n', 'utf8');
    if (!args.isRaw) {
      success(`wrote ${accumulated.length} chars to ${args.flags.out}`);
    }
  } else if (!args.isRaw) {
    process.stdout.write('\n');
    blankLine();
    step(`streamed ${accumulated.length} chars`);
  }
  return 0;
}

interface SseFrame {
  event: string;
  data: string;
}

function parseSseFrame(frame: string): SseFrame {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  return { event, data: dataLines.join('\n') };
}

/** Reverses JSON.stringify(s).slice(1,-1) from the api's SSE writer. */
function unescapeJsonChunk(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
}

async function readFileOrFail(path: string): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    return await readFile(path, 'utf8');
  } catch {
    printError(`could not read ${path}`);
    return null;
  }
}

interface SchemaCurrentResponse {
  deploymentId: string | null;
  snapshot: {
    tables: Record<
      string,
      {
        columns: Record<
          string,
          {
            sqlType: string;
            nullable: boolean;
            primaryKey: boolean;
            unique: boolean;
            references?: { table: string; column: string };
          }
        >;
      }
    >;
  } | null;
}

async function fetchSchemaContext(
  apiOrigin: string,
  apiKey: string,
  projectId: string,
): Promise<string | null> {
  try {
    const res = await apiCall<SchemaCurrentResponse>(
      `/v1/projects/${projectId}/schema/current`,
      { apiOrigin, apiKey },
    );
    if (!res.snapshot) return null;
    const lines: string[] = [];
    for (const [tableName, table] of Object.entries(res.snapshot.tables)) {
      const cols = Object.entries(table.columns)
        .map(([name, col]) => {
          const parts = [`${name}: ${col.sqlType}`];
          if (col.primaryKey) parts.push('PK');
          if (col.unique) parts.push('UNIQUE');
          if (!col.nullable) parts.push('NOT NULL');
          if (col.references) parts.push(`-> ${col.references.table}.${col.references.column}`);
          return `  ${parts.join(' ')}`;
        })
        .join('\n');
      lines.push(`table ${tableName} {\n${cols}\n}`);
    }
    return lines.join('\n\n');
  } catch {
    // The api couldn't resolve a current schema (project never deployed,
    // or fetch failed). Returning null tells the caller to skip context;
    // the model still answers, just without table/column hints.
    return null;
  }
}

function printHelp(sub?: Subcommand): void {
  banner('ai');
  blankLine();
  if (!sub || sub === 'schema') {
    step('briven ai schema "<prompt>"           generate a draft schema.ts');
    step('  --out <path>                       write to file instead of stdout');
  }
  if (!sub || sub === 'function') {
    step('briven ai function "<prompt>"         generate a draft function file');
    step('  --with-schema                      include current project schema as context');
    step('  --out <path>                       write to file instead of stdout');
  }
  if (!sub || sub === 'explain') {
    step('briven ai explain --file <path>       explain a briven code file');
    step('briven ai explain "<inline snippet>"');
    step('  --perspective "<note>"             shape the explanation (e.g. "i\'m new")');
    step('  --out <path>                       write to file instead of stdout');
  }
  if (!sub) {
    blankLine();
    step('shared flags:');
    step('  --raw                              skip banners + meta footer');
    step('  --stream                           render tokens as they arrive (SSE)');
    step('AI is gated by ollama on the api host. exit code 2 means not_configured.');
  }
}
