import { brivenError } from '@briven/shared';

/**
 * Minimal client for the flndrn Ollama gateway (ai.flndrn.com).
 *
 * Briven's in-product assistant runs on flndrn's OWN self-hosted Ollama —
 * no per-token cost, fully independent (made in Flanders). We talk to it the
 * same way ghostbot does: POST `{base}/chat` with a Bearer key, model
 * qwen2.5-coder:14b (a coder model — excellent at emitting clean JSON).
 *
 * `format: 'json'` constrains the model to a single valid JSON document so
 * the assistant's "build plan" parses deterministically with no scraping.
 *
 * Env (set on briven-france):
 *   OLLAMA_BASE_URL  default https://ai.flndrn.com/api
 *   OLLAMA_MODEL     default qwen2.5-coder:14b
 *   OLLAMA_API_KEY   required — without it the assistant degrades gracefully
 */

const BASE = process.env.OLLAMA_BASE_URL ?? 'https://ai.flndrn.com/api';
const MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:14b';
const API_KEY = process.env.OLLAMA_API_KEY ?? '';

/** True when an API key is present — UI uses this to fail gracefully. */
export function assistantConfigured(): boolean {
  return API_KEY.length > 0;
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/**
 * One non-streaming chat completion. When `json` is true the model is
 * constrained to a valid JSON document (Ollama `format: 'json'`). Returns
 * the raw assistant text. Throws a brivenError (502/503) on misconfig or
 * upstream failure so the route surfaces a clean, friendly error.
 */
export async function ollamaChat(
  messages: readonly ChatMessage[],
  opts: { json?: boolean; temperature?: number; timeoutMs?: number } = {},
): Promise<string> {
  if (!assistantConfigured()) {
    throw new brivenError('assistant_unconfigured', 'the assistant is not configured yet', {
      status: 503,
    });
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        ...(opts.json ? { format: 'json' } : {}),
        options: { temperature: opts.temperature ?? 0.2 },
        messages,
      }),
    });
  } catch (err) {
    throw new brivenError('assistant_unreachable', 'could not reach the assistant — try again', {
      status: 502,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new brivenError('assistant_upstream_error', `the assistant brain returned ${res.status}`, {
      status: 502,
      context: { detail: detail.slice(0, 300) },
    });
  }
  const body = (await res.json().catch(() => null)) as { message?: { content?: string } } | null;
  const content = body?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new brivenError('assistant_empty', 'the assistant returned an empty answer', {
      status: 502,
    });
  }
  return content;
}

export { MODEL as ASSISTANT_MODEL };
