import { NextResponse } from 'next/server';

import { searchDocs } from '../../../lib/docs-corpus';

/**
 * Docs search endpoint. Returns the top-N pages by word-overlap against
 * a query. Pre-stages the AI docs assistant — when ollama is wired the
 * inference layer reads from this same corpus + ranking, picks the top
 * 3, and forwards them as system-prompt context.
 *
 * Public, no auth — it serves the same docs anyone can read at the
 * paths in the response. Capped at 25 results so a runaway client
 * can't pull the entire corpus in one call (the corpus is small but
 * the response would still be ~3 KB, and a public endpoint deserves
 * the bound).
 */

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const limitParam = Number(searchParams.get('limit') ?? '5');
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.floor(limitParam), 1), 25)
    : 5;

  if (q.length === 0) {
    return NextResponse.json({ query: '', results: [] });
  }

  const matches = searchDocs(q, limit);
  return NextResponse.json({
    query: q,
    results: matches.map((m) => ({
      slug: m.slug,
      title: m.title,
      summary: m.summary,
    })),
  });
}
