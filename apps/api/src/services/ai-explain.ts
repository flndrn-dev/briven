import { env } from '../env.js';
import { log } from '../lib/logger.js';

import { AiNotConfiguredError } from './ai-schema-gen.js';

/**
 * AI explain code — third member of the briven AI trifecta (schema +
 * function + explain). Takes a snippet of briven schema/function code
 * and returns a plain-english explanation framed in briven idioms (what
 * the wrapper means, which db calls happen, where the reactivity hooks
 * in, what would change if you flipped it from query() to mutation()).
 *
 * Same posture as the other two generators: forwards to Ollama on the
 * DGX VPS; prompts and outputs are not logged; returns the shared
 * AiNotConfiguredError when BRIVEN_OLLAMA_URL is unset so callers can
 * collapse the 503 path.
 */

const SYSTEM_PROMPT = `You are a briven code explainer. Given a snippet of typescript using briven's schema dsl or function wrappers, explain what it does in plain english.

Rules:
- Explain at the level of "a developer new to briven, comfortable with typescript". Don't restate the obvious (e.g. "this imports a function from a package").
- Call out the briven-specific decisions:
  - query() vs mutation() vs action() — what does the wrapper mean for reactivity, transactions, retries?
  - ctx.db chains — which tables are touched, which indexes would matter?
  - brivenError vs throwing a plain Error — what code/status does the client receive?
  - schema column choices — when does notNull / references / unique matter?
  - jsonb<T> type args — what does the type assertion give you on reads?
- If the snippet has a bug or a sharp edge, point it out (e.g. unbounded result sets, missing input validation, n+1 patterns).
- Keep the explanation under 250 words. Use short paragraphs and bullet lists, not walls of prose. No markdown code fences.
- If the snippet isn't briven code (e.g. unrelated typescript, sql, prose) say so in one sentence and stop — don't try to make sense of it.`;

export interface AiExplainInput {
  /** The code to explain. Capped at 8 KB at the route to keep the model context bounded. */
  code: string;
  /** Optional caller note: "I'm new to briven", "I migrated from prisma", etc. Shapes the depth. */
  perspective?: string;
  timeoutMs?: number;
}

export interface AiExplainResult {
  explanation: string;
  model: string;
  elapsedMs: number;
}

export async function explainCode(input: AiExplainInput): Promise<AiExplainResult> {
  if (!env.BRIVEN_OLLAMA_URL) {
    throw new AiNotConfiguredError();
  }

  const userMessage =
    input.perspective && input.perspective.trim().length > 0
      ? `Perspective: ${input.perspective.trim()}\n\nExplain this code:\n\`\`\`ts\n${input.code}\n\`\`\``
      : `Explain this code:\n\`\`\`ts\n${input.code}\n\`\`\``;

  const t0 = Date.now();
  const url = `${env.BRIVEN_OLLAMA_URL.replace(/\/$/, '')}/api/generate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.BRIVEN_OLLAMA_MODEL,
      system: SYSTEM_PROMPT,
      prompt: userMessage,
      // Higher than schema/function generators — explanation is prose,
      // where a touch more variation reads as natural rather than
      // robotic. Still well below "creative writing" temps.
      options: { temperature: 0.4 },
      stream: false,
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
  });

  const elapsedMs = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.warn('ai_explain_upstream_error', {
      status: res.status,
      elapsedMs,
      bodyPreview: body.slice(0, 240),
    });
    throw new Error(`Ollama returned ${res.status}`);
  }

  const data = (await res.json()) as { response?: string };
  const explanation = (data.response ?? '').trim();

  log.info('ai_explain_ok', {
    codeLen: input.code.length,
    perspectiveLen: input.perspective?.length ?? 0,
    explanationLen: explanation.length,
    model: env.BRIVEN_OLLAMA_MODEL,
    elapsedMs,
  });

  return {
    explanation,
    model: env.BRIVEN_OLLAMA_MODEL,
    elapsedMs,
  };
}
