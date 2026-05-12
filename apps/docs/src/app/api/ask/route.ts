import { NextResponse } from 'next/server';

import { searchDocs, type DocsCorpusEntry } from '../../../lib/docs-corpus';

/**
 * AI docs assistant. Takes a free-form question, finds the top 3 docs
 * pages by word-overlap (the same corpus that powers /api/search), and
 * forwards a prompt to ollama with those pages as system-prompt
 * context. Returns the model's answer + the three slugs the answer is
 * grounded in.
 *
 * Public, no auth. The ollama URL + key live on this server-side route
 * — they never reach the client. When BRIVEN_OLLAMA_URL is unset
 * (typical for the docs container until ai.flndrn.com config lands)
 * the endpoint returns 503 not_configured and the docs UI renders an
 * "ask is offline" state.
 *
 * Same auth shape as the api workspace: X-API-Key when
 * BRIVEN_OLLAMA_API_KEY is set, no header when on a private network
 * with a local DGX.
 */

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are the briven.tech docs assistant. Answer the user's question using ONLY the docs pages provided below as context.

Rules:
- Cite specific pages by their slug in [brackets] when you reference them.
- If the context doesn't cover the question, say so plainly. Don't invent answers.
- Use plain english + short paragraphs. No marketing voice. No exclamation points.
- briven uses lowercase consistently — match that voice.
- Keep the answer under 200 words. The reader has the docs one click away.`;

interface AskBody {
  question?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const ollamaUrl = process.env.BRIVEN_OLLAMA_URL;
  if (!ollamaUrl) {
    return NextResponse.json(
      {
        code: 'not_configured',
        message: 'AI features are disabled on this deployment (BRIVEN_OLLAMA_URL unset)',
      },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as AskBody;
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (question.length === 0 || question.length > 2000) {
    return NextResponse.json(
      { code: 'validation_failed', message: 'question must be a 1-2000 char string' },
      { status: 400 },
    );
  }

  // Retrieval — pick the top 3 corpus entries by word overlap.
  const top = searchDocs(question, 3);
  const contextBlock = renderContext(top);

  // Inference — forward to ollama with the retrieved context as the
  // system prompt's tail. X-API-Key when BRIVEN_OLLAMA_API_KEY is set.
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.BRIVEN_OLLAMA_API_KEY) {
    headers['x-api-key'] = process.env.BRIVEN_OLLAMA_API_KEY;
  }
  const model =
    process.env.BRIVEN_OLLAMA_MODEL_DOCS ?? process.env.BRIVEN_OLLAMA_MODEL ?? 'qwen2.5-coder:latest';

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        system: `${SYSTEM_PROMPT}\n\nContext (top ${top.length} matching docs pages):\n${contextBlock}`,
        prompt: question,
        options: { temperature: 0.3 },
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    return NextResponse.json(
      {
        code: 'upstream_error',
        message: err instanceof Error ? err.message : 'fetch failed',
      },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const upstreamBody = await res.text().catch(() => '');
    return NextResponse.json(
      {
        code: 'upstream_error',
        status: res.status,
        message: upstreamBody.slice(0, 240),
      },
      { status: 502 },
    );
  }

  const data = (await res.json()) as { response?: string };
  const answer = (data.response ?? '').trim();

  return NextResponse.json({
    question,
    answer,
    citations: top.map((c) => ({ slug: c.slug, title: c.title })),
    model,
    elapsedMs: Date.now() - t0,
  });
}

function renderContext(entries: readonly DocsCorpusEntry[]): string {
  return entries
    .map(
      (e) =>
        `[${e.slug}] ${e.title}\n${e.summary}\nkeywords: ${e.keywords.join(', ')}`,
    )
    .join('\n\n---\n\n');
}
