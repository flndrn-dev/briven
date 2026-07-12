import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * The grounded answer-writer behind `briven_ask`'s self-growing knowledge
 * base (owner-approved 2026-07-12). When no hand-curated guide matches a
 * question, this composes a fresh three-part answer — but ONLY from briven's
 * own docs/guide context passed in as `grounding`. It never invents a
 * capability and never suggests going off-platform: a genuine gap must be
 * returned as `grounded: false`, which the desk turns into the honest
 * "filed for review" reply.
 *
 * Dormant-safe: briven's model engine (BRIVEN_OLLAMA_URL) may be switched
 * off (e.g. the "Ollama offline until N5 Pro" state). With it unset this
 * returns `{ grounded: false }` immediately, so the desk simply falls back
 * to today's filed behaviour — the auto-writer lights up on its own the day
 * the engine returns, with no code change or redeploy.
 *
 * Same posture as the ai-explain/schema/function generators: forwards to the
 * self-hosted model on the DGX VPS; prompts/outputs are not logged.
 */

export interface GroundedAnswer {
  howBrivenWorksHere: string;
  whatOurToolsGiveYou: string[];
  whatYouBuildInYourProject: string[];
  docs: string;
}

export type WriteGroundedResult =
  | { grounded: true; answer: GroundedAnswer; model: string }
  | { grounded: false };

export const ANSWER_WRITER_SYSTEM_PROMPT = `You are briven's knowledge-desk writer. An AI agent building on the briven backend platform asked a question that no hand-curated guide matched. Compose ONE answer, using ONLY the briven context provided in the user message. briven is the fixed platform; the agent builds its project WITHIN it using only the tools briven exposes.

Output STRICT JSON (no markdown, no code fences, no prose outside the object) with exactly these fields:
{
  "grounded": boolean,
  "howBrivenWorksHere": string,
  "whatOurToolsGiveYou": string[],
  "whatYouBuildInYourProject": string[],
  "docs": string
}

Hard rules:
- Answer ONLY from the provided briven context. If the context does not clearly support an answer, set "grounded": false and leave the other fields as empty string / empty arrays. Never guess, never invent an endpoint, tool, flag, or capability that is not in the context.
- NEVER suggest standing up a separate/side database or server, a durable raw or superuser SQL login, or asking briven for special credentials or bespoke features. briven mediates every data touch on purpose. If the agent seems to want raw SQL or a side DB, the correct answer is to use functions + the MCP/SDK within the platform.
- If the capability genuinely does not exist on briven, set "grounded": false — do NOT manufacture a workaround. A true gap is filed for the platform team, not worked around off-platform.
- "docs" must be one URL copied from the provided context (do not invent a URL). If unsure, use https://docs.briven.tech.
- Never name any third-party vendor in the prose.
- Keep each string tight and practical; whatOurToolsGiveYou / whatYouBuildInYourProject are 1-4 bullets each.`;

/**
 * Compose a grounded answer, or decline. Fail-soft: any upstream/parse error
 * returns `{ grounded: false }` (never throws) so the calling desk stays
 * responsive no matter what the model does.
 */
export async function writeGroundedAnswer(input: {
  question: string;
  /** briven's own docs/guide context — the ONLY knowledge the model may use. */
  grounding: string;
  timeoutMs?: number;
}): Promise<WriteGroundedResult> {
  if (!env.BRIVEN_OLLAMA_URL) return { grounded: false };

  const model = env.BRIVEN_OLLAMA_MODEL_EXPLAIN ?? env.BRIVEN_OLLAMA_MODEL;
  if (!model) return { grounded: false };

  const userMessage =
    `briven context (the ONLY source you may use):\n${input.grounding}\n\n` +
    `Agent question:\n${input.question}`;

  const url = `${env.BRIVEN_OLLAMA_URL.replace(/\/$/, '')}/api/generate`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.BRIVEN_OLLAMA_API_KEY) headers['x-api-key'] = env.BRIVEN_OLLAMA_API_KEY;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        system: ANSWER_WRITER_SYSTEM_PROMPT,
        prompt: userMessage,
        // Low temperature: this is grounded extraction, not creative writing.
        options: { temperature: 0.1 },
        // Ollama honours a JSON grammar so we get a parseable object back.
        format: 'json',
        stream: false,
      }),
      // Kept tight on purpose: this runs inline in a live MCP tool call, so a
      // slow model must not freeze the agent. If it can't answer in time we
      // fall through to the honest "filed" reply and the desk stays snappy.
      signal: AbortSignal.timeout(input.timeoutMs ?? 12_000),
    });
  } catch (err) {
    log.warn('mcp_answer_writer_unreachable', {
      message: err instanceof Error ? err.message : String(err),
    });
    return { grounded: false };
  }

  if (!res.ok) {
    log.warn('mcp_answer_writer_upstream_error', { status: res.status });
    return { grounded: false };
  }

  let raw: string;
  try {
    const data = (await res.json()) as { response?: string };
    raw = (data.response ?? '').trim();
  } catch {
    return { grounded: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { grounded: false };
  }

  const answer = coerceGroundedAnswer(parsed);
  if (!answer) return { grounded: false };

  return { grounded: true, answer, model };
}

/**
 * Normalise the answer fields into a GroundedAnswer, or null if the object is
 * substanceless. Shared by both the writer-output path (coerceGroundedAnswer)
 * and the cache-read path (validateStoredAnswer) so a blank/malformed answer
 * can never be served — whether it came from the model or a hand-seeded row.
 */
function normalizeAnswerFields(o: Record<string, unknown>): GroundedAnswer | null {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const list = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => str(x)).filter((s) => s.length > 0).slice(0, 6)
      : [];

  const howBrivenWorksHere = str(o.howBrivenWorksHere);
  const whatOurToolsGiveYou = list(o.whatOurToolsGiveYou);
  const whatYouBuildInYourProject = list(o.whatYouBuildInYourProject);
  let docs = str(o.docs);
  if (!/^https?:\/\//i.test(docs)) docs = 'https://docs.briven.tech';

  // An answer with no substance is treated as a decline, not a cached blank.
  if (howBrivenWorksHere.length < 10 && whatOurToolsGiveYou.length === 0) return null;

  return { howBrivenWorksHere, whatOurToolsGiveYou, whatYouBuildInYourProject, docs };
}

/**
 * Validate + normalise the MODEL's JSON into a GroundedAnswer, or null if it
 * declined (grounded:false) or produced an unusable shape. Exported for unit
 * tests that exercise the parsing without a live model.
 */
export function coerceGroundedAnswer(parsed: unknown): GroundedAnswer | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (o.grounded !== true) return null;
  return normalizeAnswerFields(o);
}

/**
 * Validate a STORED (already-coerced) answer read back from the cache — same
 * substance guard as the writer path, but without requiring the `grounded`
 * flag (stored rows hold only the answer fields). Returns null for any
 * blank/drifted/hand-seeded row so the desk falls through instead of serving
 * garbage.
 */
export function validateStoredAnswer(parsed: unknown): GroundedAnswer | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  return normalizeAnswerFields(parsed as Record<string, unknown>);
}
