import Link from 'next/link';

import { DocsShell } from '../../components/shell';

export const metadata = { title: 'vector search' };

export default function VectorSearchPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">vector search</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        briven supports pgvector as a first-class column type and exposes a `ctx.db.vectorSearch`
        chain for nearest-neighbour queries inside any function. embeddings can come from
        anywhere — you pass the vector in; briven runs the search.
      </p>

      <Section title="schema declaration">
        <p>
          declare a `vector(N)` column on any table. `N` is the embedding dimension your model
          produces — 768 for nomic-embed-text, 1536 for OpenAI text-embedding-3-small, etc.
        </p>
        <Snippet>{`import { schema, table, text, timestamp, vector } from '@briven/cli/schema';

export default schema({
  documents: table({
    columns: {
      id:        text().primaryKey(),
      title:     text().notNull(),
      body:      text().notNull(),
      embedding: vector(768).notNull(),  // 768 dims = nomic-embed-text
      createdAt: timestamp().notNull().default('now()'),
    },
    indexes: [
      // index the vector column for fast ANN search. without the index,
      // postgres falls back to a sequential scan — fine for <10k rows,
      // painful past that.
      { columns: ['embedding'], unique: false },
    ],
  }),
});`}</Snippet>
        <p>
          briven&apos;s migration apply path runs <code>CREATE EXTENSION IF NOT EXISTS vector</code>{' '}
          automatically before applying any schema that declares a vector column; you don&apos;t
          need to enable pgvector manually on the project shard.
        </p>
      </Section>

      <Section title="search query">
        <p>
          inside a function, call <code>ctx.db(&apos;documents&apos;).vectorSearch(...)</code> with
          a query vector + the column name + optional distance / limit / where filter.
        </p>
        <Snippet>{`// briven/functions/searchDocs.ts
import { query, type Ctx } from '@briven/cli/server';

interface Args {
  embedding: number[];
  topK?: number;
}

export default query(async (ctx: Ctx, args: Args) => {
  return ctx
    .db('documents')
    .vectorSearch({
      column: 'embedding',
      vector: args.embedding,
      distance: 'cosine',         // 'l2' (default) | 'inner_product' | 'cosine'
      limit: args.topK ?? 10,
    })
    .where({ archived: false })   // optional predicate filter
    .select(['id', 'title', 'body']);
});`}</Snippet>
        <p>
          the returned rows are ordered by similarity to the query vector — closest first.
          the vector column itself is omitted from the response unless you explicitly include it
          in <code>.select()</code>.
        </p>
      </Section>

      <Section title="generating embeddings">
        <p>
          briven doesn&apos;t generate embeddings — that&apos;s your call. three common shapes:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <strong>self-hosted via the briven ollama proxy</strong>: if your operator has
            <code> nomic-embed-text </code> available (the briven.tech proxy does today), POST to{' '}
            <code>/api/embeddings</code> from inside an <code>action()</code> function — same auth
            shape as the AI features.
          </li>
          <li>
            <strong>third-party API</strong>: OpenAI, Voyage, Cohere — call from inside an{' '}
            <code>action()</code> (not a query/mutation; embeddings are slow + idempotent and
            should live outside the transaction).
          </li>
          <li>
            <strong>at write time</strong>: when you insert a document, compute its embedding in
            the same mutation and store it. queries become cheap.
          </li>
        </ul>
        <Snippet>{`// briven/functions/indexDocument.ts — embed at write time
import { mutation, type Ctx } from '@briven/cli/server';
import { ulid } from '@briven/shared';

interface Args { title: string; body: string }

export default mutation(async (ctx: Ctx, args: Args) => {
  // embedded inline; the briven ollama proxy serves nomic-embed-text
  // alongside the chat models. swap for OpenAI / Voyage as needed.
  const res = await fetch('https://ai.flndrn.com/api/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ctx.env.OLLAMA_API_KEY ?? '',
    },
    body: JSON.stringify({ model: 'nomic-embed-text:latest', prompt: args.body }),
  });
  const { embedding } = (await res.json()) as { embedding: number[] };

  const id = ulid('doc');
  const [row] = await ctx
    .db('documents')
    .insert({ id, title: args.title, body: args.body, embedding })
    .returning();
  return row;
});`}</Snippet>
      </Section>

      <Section title="distance operators">
        <p>three operators are supported, mapping to pgvector&apos;s native ones:</p>
        <ul className="list-disc pl-5">
          <li>
            <code>l2</code> (default) — euclidean distance. pgvector <code>&lt;-&gt;</code>.
            best for embeddings where magnitude matters.
          </li>
          <li>
            <code>cosine</code> — cosine distance. pgvector <code>&lt;=&gt;</code>. best for
            text embeddings where similarity is direction, not magnitude.
          </li>
          <li>
            <code>inner_product</code> — negative inner product. pgvector{' '}
            <code>&lt;#&gt;</code>. fastest; use when your embeddings are already normalised.
          </li>
        </ul>
        <p>
          if you&apos;re unsure, start with <code>cosine</code> for text embeddings and{' '}
          <code>l2</code> for image embeddings. the choice affects ranking, not correctness — a
          query that finds the right neighbours under one operator generally does under the
          others.
        </p>
      </Section>

      <Section title="indexes and recall">
        <p>
          for tables past ~10,000 rows, declare an index on the vector column. briven&apos;s
          schema apply path creates an HNSW index when it sees an index on a vector column —
          ANN search becomes sub-millisecond instead of seconds.
        </p>
        <p>
          HNSW trades exactness for speed: a query may not return the absolute closest neighbour
          every time, but the recall is &gt; 95% in typical configurations. for cases where
          exact recall matters (medical / legal retrieval), remove the index and accept the
          sequential scan — fine for &lt; 50k rows on a decent box.
        </p>
      </Section>

      <Section title="what's NOT in v1">
        <ul className="list-disc pl-5">
          <li>
            <strong>hybrid search</strong> (vector + text BM25). pgvector + tsvector both exist
            in postgres; combining them is a manual <code>ctx.db.execute(raw_sql)</code> today.
            a first-class hybrid helper is queued for the wrapper SDK&apos;s year-two work.
          </li>
          <li>
            <strong>embedding generation inside the query</strong>. briven leaves embedding to
            your code so we don&apos;t pick a model for you. when the ai docs assistant ships
            a generic embed endpoint, this guide will update.
          </li>
          <li>
            <strong>per-tenant vector indexes</strong>. all rows in a table share one HNSW
            index. for multi-tenant projects, scope by a <code>where</code> clause — the index
            still helps; just at the candidate-set selection step.
          </li>
        </ul>
      </Section>

      <p className="mt-12 font-mono text-xs text-[var(--color-text-subtle)]">
        related:{' '}
        <Link href="/schema" className="underline">
          schema dsl
        </Link>{' '}
        ·{' '}
        <Link href="/functions" className="underline">
          functions
        </Link>{' '}
        ·{' '}
        <Link href="/ai" className="underline">
          ai features
        </Link>
      </p>
    </DocsShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-mono text-lg">{title}</h2>
      <div className="mt-2 space-y-3 font-mono text-sm text-[var(--color-text-muted)]">
        {children}
      </div>
    </section>
  );
}

function Snippet({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs">
      <code>{children}</code>
    </pre>
  );
}
