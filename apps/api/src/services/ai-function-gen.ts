import { env } from '../env.js';
import { log } from '../lib/logger.js';

import { AiNotConfiguredError } from './ai-schema-gen.js';

/**
 * AI function generator — pairs with `ai-schema-gen.ts` to round out the
 * Phase 3 AI differentiator.
 *
 * Takes a natural-language description ("list all posts published in the
 * last 24 hours, newest first") plus the project's current schema as
 * context, returns a single TypeScript file the user can drop into
 * `briven/functions/<name>.ts`.
 *
 * Same posture as the schema generator: posts to Ollama running Qwen
 * 2.5-coder on the DGX VPS; prompts and outputs are NOT logged (the
 * operator might include real business names in the prompt). Only the
 * prompt length + elapsed-ms + status code are recorded.
 */

const SYSTEM_PROMPT = `You are a briven function author. Given a short description of an operation and the project's current schema, output a single TypeScript file that defines exactly one briven function (query, mutation, or action).

Rules:
- Import the wrapper + Ctx + brivenError from '@briven/cli/server'.
- Pick the right wrapper:
  - query  — read-only; reactive subscriptions re-run it on dependency change.
  - mutation — writes; transactional within a single function call.
  - action — long-running or non-DB side effects (HTTP, email). NOT reactive, NOT in a DB transaction.
- The function signature is always (ctx: Ctx, args: <ArgsInterface>) => …
- Use ctx.db('<table>') to interact with the data plane. Common chains:
  .select([...]).where(…).orderBy(…).limit(…).first()
  .insert({…}).returning()
  .update({…}).where({…}).returning()
  .delete().where({…})
- Throw brivenError('validation_failed', 'reason', { status: 400 }) for bad input.
  Throw brivenError('not_found', 'reason', { status: 404 }) when a referenced row is missing.
  Throw brivenError('forbidden', 'reason', { status: 403 }) for authz checks.
- Always validate required string args (.trim() + length check) before using them.
- Use ulid('<prefix>') from '@briven/shared' when minting ids — prefer table-tied prefixes (e.g. 'msg', 'rm', 'pst').
- Default export the wrapped function — exactly one default export per file.
- Return ONLY the function file's contents. No prose, no markdown fences, no explanation.

Example shape (a query):
import { brivenError, query, type Ctx } from '@briven/cli/server';

interface Args {
  roomId: string;
  limit?: number;
}

export default query(async (ctx: Ctx, args: Args) => {
  if (!args.roomId) throw new brivenError('validation_failed', 'roomId required', { status: 400 });
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  return ctx
    .db('messages')
    .select(['id', 'roomId', 'authorName', 'body', 'createdAt'])
    .where({ roomId: args.roomId })
    .orderBy('createdAt', 'desc')
    .limit(limit);
});

Example shape (a mutation):
import { brivenError, mutation, type Ctx } from '@briven/cli/server';
import { ulid } from '@briven/shared';

interface Args {
  name: string;
}

export default mutation(async (ctx: Ctx, args: Args) => {
  const name = args.name?.trim();
  if (!name) throw new brivenError('validation_failed', 'name required', { status: 400 });
  if (name.length > 64) throw new brivenError('validation_failed', 'name too long', { status: 400 });
  const id = ulid('rm');
  const [row] = await ctx.db('rooms').insert({ id, name }).returning();
  return row;
});`;

export interface AiFunctionGenInput {
  prompt: string;
  /**
   * Optional — the project's current schema.ts contents. When provided we
   * inject it into the user message so the model knows which tables and
   * columns exist; without it the model has to guess at the schema shape.
   * Cap at 8 KB so the prompt stays well inside the model's context.
   */
  schemaContext?: string;
  timeoutMs?: number;
}

export interface AiFunctionGenResult {
  function: string;
  model: string;
  elapsedMs: number;
}

const SCHEMA_CONTEXT_MAX_BYTES = 8 * 1024;

export async function generateFunction(input: AiFunctionGenInput): Promise<AiFunctionGenResult> {
  if (!env.BRIVEN_OLLAMA_URL) {
    throw new AiNotConfiguredError();
  }

  // Schema context is operator-controlled but pull through a hard cap
  // anyway — the model context isn't unbounded and we'd rather truncate
  // than fail with an opaque upstream 4xx.
  let userMessage = input.prompt;
  if (input.schemaContext && input.schemaContext.length > 0) {
    const ctx = input.schemaContext.slice(0, SCHEMA_CONTEXT_MAX_BYTES);
    userMessage =
      `Current schema:\n\`\`\`ts\n${ctx}\n\`\`\`\n\n` +
      `Write a function that: ${input.prompt}`;
  }

  // Per-feature model override per docs/AI.md.
  const model = env.BRIVEN_OLLAMA_MODEL_FUNCTION ?? env.BRIVEN_OLLAMA_MODEL;
  const t0 = Date.now();
  const url = `${env.BRIVEN_OLLAMA_URL.replace(/\/$/, '')}/api/generate`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.BRIVEN_OLLAMA_API_KEY) {
    headers['x-api-key'] = env.BRIVEN_OLLAMA_API_KEY;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      system: SYSTEM_PROMPT,
      prompt: userMessage,
      // Slightly higher than the schema generator — functions have more
      // surface area where small variation reads as natural rather than
      // a sign of confusion. Still firmly in the deterministic range.
      options: { temperature: 0.3 },
      stream: false,
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
  });

  const elapsedMs = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.warn('ai_function_gen_upstream_error', {
      status: res.status,
      elapsedMs,
      bodyPreview: body.slice(0, 240),
    });
    throw new Error(`Ollama returned ${res.status}`);
  }

  const data = (await res.json()) as { response?: string };
  const fnText = stripMarkdownFences((data.response ?? '').trim());

  log.info('ai_function_gen_ok', {
    promptLen: input.prompt.length,
    schemaCtxLen: input.schemaContext?.length ?? 0,
    fnLen: fnText.length,
    model,
    elapsedMs,
  });

  return {
    function: fnText,
    model,
    elapsedMs,
  };
}

/**
 * Strip a leading ```ts / ```typescript fence and trailing ``` if the
 * model ignored the "no markdown fences" instruction (Qwen sometimes
 * does for code-only responses). Keeps the schema generator strict
 * since it ships a simpler prompt — this one's looser context invites
 * fenced output.
 */
function stripMarkdownFences(text: string): string {
  const fenceStart = /^```(?:typescript|ts|tsx)?\s*\n/;
  const fenceEnd = /\n```\s*$/;
  if (fenceStart.test(text) && fenceEnd.test(text)) {
    return text.replace(fenceStart, '').replace(fenceEnd, '');
  }
  return text;
}
