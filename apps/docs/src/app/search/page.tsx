import Link from 'next/link';

import { DocsShell } from '../../components/shell';
import { searchDocs } from '../../lib/docs-corpus';

export const metadata = { title: 'docs search' };
export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? '';
  const results = query.length > 0 ? searchDocs(query, 10) : [];

  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">search docs</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        keyword search across every docs page. an AI-assisted answer surface lights up once the
        ollama backend is wired — until then, the keyword match below is the way.
      </p>

      <form method="get" className="mt-6 flex gap-2">
        <input
          name="q"
          type="search"
          defaultValue={query}
          placeholder="how do I make a query reactive?"
          autoFocus
          className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
        />
        <button
          type="submit"
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)]"
        >
          search
        </button>
      </form>

      {query.length > 0 ? (
        results.length === 0 ? (
          <p className="mt-8 font-mono text-sm text-[var(--color-text-muted)]">
            no pages matched <code>{query}</code>. try a broader term, or open an issue —
            missing-doc reports are how the corpus grows.
          </p>
        ) : (
          <ul className="mt-8 flex flex-col gap-4">
            {results.map((r) => (
              <li key={r.slug}>
                <Link
                  href={r.slug}
                  className="block rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-border)]"
                >
                  <p className="font-mono text-sm text-[var(--color-text)]">{r.title}</p>
                  <p className="mt-1 font-mono text-xs text-[var(--color-text-subtle)]">
                    {r.slug}
                  </p>
                  <p className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
                    {r.summary}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </DocsShell>
  );
}
