import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * AI schema generator — Phase 3 differentiator.
 *
 * Takes a natural-language prompt ("a blog with users, posts, comments,
 * each comment can reply to another comment") and returns a draft
 * briven schema.ts as a single TypeScript string the user pastes into
 * the dashboard editor.
 *
 * Implementation: posts to a self-hosted Ollama running Qwen 2.5-coder
 * 32B on the DGX VPS. The platform-side endpoint applies a system
 * prompt that pins the briven schema DSL conventions; the model
 * returns just the code, which we surface verbatim.
 *
 * Privacy: prompts and outputs are NOT logged (the operator might
 * include real business names in the prompt). Only the prompt length +
 * elapsed-ms + status code are recorded for ops monitoring.
 */

const SYSTEM_PROMPT = `You are a briven schema author. Given a short description of an app's data model, output a single TypeScript file that exports a schema definition using briven's DSL.

Rules:
- Import only from '@briven/cli/schema'.
- Available column helpers: text(), bigint(), boolean(), timestamp(), jsonb<T>(), uuid().
- Modifiers: .primaryKey(), .notNull(), .default(...), .nullable(), .references(table, column), .unique().
- Every table needs a primary-key column. Prefer text() id for ULIDs. Use bigint() only for counters.
- Add index hints only where a non-trivial query would scan. Don't over-index.
- Return ONLY the schema file's contents. No prose, no markdown fences, no explanation.

Example shape:
import { boolean, schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  posts: table({
    id: text().primaryKey(),
    body: text().notNull(),
    createdAt: timestamp().default('now()').notNull(),
    publishedAt: timestamp().nullable(),
  }),
});`;

export interface AiSchemaGenInput {
  prompt: string;
  /** Hard cap to keep the model from running away. Defaults to 60s. */
  timeoutMs?: number;
}

export interface AiSchemaGenResult {
  schema: string;
  model: string;
  elapsedMs: number;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super('Ollama base URL not configured (set BRIVEN_OLLAMA_URL)');
    this.name = 'AiNotConfiguredError';
  }
}

export async function generateSchema(input: AiSchemaGenInput): Promise<AiSchemaGenResult> {
  if (!env.BRIVEN_OLLAMA_URL) {
    throw new AiNotConfiguredError();
  }
  // Per-feature model override per docs/AI.md — falls back to the
  // default model when the feature-specific var is unset.
  const model = env.BRIVEN_OLLAMA_MODEL_SCHEMA ?? env.BRIVEN_OLLAMA_MODEL;
  const t0 = Date.now();
  const url = `${env.BRIVEN_OLLAMA_URL.replace(/\/$/, '')}/api/generate`;
  // why: the production "Ollama Console" proxy at ai.flndrn.com gates
  // requests behind an X-API-Key header (NOT Authorization: Bearer —
  // they reject Bearer with 401). A local DGX on a private net doesn't
  // need any auth. Send the header only when configured so both shapes
  // work. Future: if the proxy adds Bearer support, we can swap or add
  // a BRIVEN_OLLAMA_AUTH_HEADER toggle.
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
      prompt: input.prompt,
      // Deterministic-ish output. Schema generation is structural and
      // benefits from low temperature; the model still has room to vary
      // wording but column shapes stay stable across re-runs.
      options: { temperature: 0.2 },
      // We want one full response, not a stream.
      stream: false,
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
  });

  const elapsedMs = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.warn('ai_schema_gen_upstream_error', {
      status: res.status,
      elapsedMs,
      bodyPreview: body.slice(0, 240),
    });
    throw new Error(`Ollama returned ${res.status}`);
  }

  const data = (await res.json()) as { response?: string };
  const schemaText = (data.response ?? '').trim();

  log.info('ai_schema_gen_ok', {
    promptLen: input.prompt.length,
    schemaLen: schemaText.length,
    model,
    elapsedMs,
  });

  return {
    schema: schemaText,
    model,
    elapsedMs,
  };
}
