import { env } from '../env.js';
import { log } from '../lib/logger.js';

import { AiNotConfiguredError } from './ai-schema-gen.js';

/**
 * Streaming variant of the ai-* services. The dashboard surfaces can
 * now render tokens as they arrive instead of waiting up to 60s for
 * the full response. The Ollama backend supports streaming natively
 * via `stream: true` — the response body is a newline-delimited JSON
 * stream where each line carries a `{response: "<chunk>", done:
 * false}` event, with a final `{done: true, …}` marker.
 *
 * We re-emit those events as Server-Sent Events (SSE) so the browser
 * can consume them via EventSource. SSE is supported natively on every
 * modern browser, no extra library on the dashboard.
 *
 * Auth is the same as the non-streaming services — X-API-Key when
 * BRIVEN_OLLAMA_API_KEY is set, no header otherwise.
 */

export interface StreamInput {
  system: string;
  prompt: string;
  model: string;
  temperature: number;
  timeoutMs?: number;
}

export async function streamAiResponse(input: StreamInput): Promise<Response> {
  if (!env.BRIVEN_OLLAMA_URL) {
    throw new AiNotConfiguredError();
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.BRIVEN_OLLAMA_API_KEY) {
    headers['x-api-key'] = env.BRIVEN_OLLAMA_API_KEY;
  }

  const upstreamRes = await fetch(`${env.BRIVEN_OLLAMA_URL.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: input.model,
      system: input.system,
      prompt: input.prompt,
      options: { temperature: input.temperature },
      stream: true,
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 120_000),
  });

  if (!upstreamRes.ok || !upstreamRes.body) {
    const body = await upstreamRes.text().catch(() => '');
    log.warn('ai_stream_upstream_error', {
      status: upstreamRes.status,
      bodyPreview: body.slice(0, 240),
    });
    throw new Error(`Ollama returned ${upstreamRes.status}`);
  }

  // Translate the ollama ndjson stream into SSE. Each ollama line:
  //   {"response":"foo","done":false}
  // becomes an SSE event:
  //   event: token
  //   data: foo
  //
  // The final ollama line is `{done:true, ...}` — we emit a final
  // `event: done` so the client can dispose the EventSource cleanly.
  const ollamaStream = upstreamRes.body;
  const sseStream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const reader = ollamaStream.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            let parsed: { response?: string; done?: boolean };
            try {
              parsed = JSON.parse(line) as { response?: string; done?: boolean };
            } catch {
              continue;
            }
            if (parsed.response) {
              controller.enqueue(
                enc.encode(`event: token\ndata: ${jsonEscape(parsed.response)}\n\n`),
              );
            }
            if (parsed.done) {
              controller.enqueue(enc.encode(`event: done\ndata: {}\n\n`));
            }
          }
        }
      } catch (err) {
        controller.enqueue(
          enc.encode(
            `event: error\ndata: ${jsonEscape(err instanceof Error ? err.message : 'stream error')}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(sseStream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      // Disable buffering on proxies that respect this header (nginx).
      'x-accel-buffering': 'no',
    },
  });
}

/**
 * SSE data lines can't contain literal newlines without escaping. JSON-
 * stringify handles that (and quotes everything), then strip the outer
 * quotes since SSE doesn't need them.
 */
function jsonEscape(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}
