import Link from 'next/link';

import { DocsShell } from '../../../components/shell';

export const metadata = { title: 'migration · mongodb → briven' };

export default function MongoMigrationPage() {
  return (
    <DocsShell>
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        <Link href="/migration" className="hover:text-[var(--color-text)]">
          ← migration
        </Link>
      </p>
      <h1 className="mt-2 font-mono text-2xl tracking-tight">mongodb → briven</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        port a mongodb project onto briven. follow the ten-step playbook on{' '}
        <Link href="/migration" className="underline underline-offset-2">
          /migration
        </Link>{' '}
        — this page covers only the mongodb-specific parts.
      </p>

      <div className="mt-4 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        mongodb → postgres is the second-hardest migration shape (only firebase is harder). the
        work isn&apos;t the dump/restore — it&apos;s deciding which embedded documents stay
        embedded as <code>jsonb</code> and which get flattened into separate tables. plan for
        the schema port to take 60–80% of the project time, and run a 2+ week parallel-run
        window because shape mismatches surface late.
      </div>

      <Section title="when to keep documents embedded vs flatten">
        <p>
          briven is postgres-first. <code>jsonb&lt;T&gt;()</code> is a first-class column type, so
          you don&apos;t have to flatten every embedded doc. the decision matrix:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <strong>embedded</strong>: the sub-doc is always read with the parent, never queried
            independently, never updated in isolation. example: a <code>profile</code>{' '}
            object on a <code>user</code> doc with name/avatar/bio fields.
          </li>
          <li>
            <strong>flatten to a row</strong>: the sub-doc is independently queryable (find by an
            inner field), independently updated (atomic write to one nested item), or unbounded
            in count (notifications, audit entries). these become real tables with a foreign key.
          </li>
          <li>
            <strong>flatten to a row, eagerly fetched</strong>: when you almost always want the
            parent + child together, the rows-with-fk shape still wins. briven query functions
            return whatever shape you build — fetch both, return them as one object.
          </li>
        </ul>
        <p>
          if you can&apos;t decide, flatten. it&apos;s easier to inline two relational reads than
          to undo a too-large <code>jsonb</code> column later.
        </p>
      </Section>

      <Section title="schema port — collection → table">
        <Snippet>{`// before — mongoose-ish shape (representative)
const PostSchema = new Schema({
  _id: ObjectId,
  authorId: ObjectId,
  title: { type: String, required: true },
  body: { type: String, required: true },
  published: { type: Boolean, default: false },
  views: { type: Number, default: 0 },
  tags: [String],                                // unbounded → think hard
  author: {                                      // embedded, always read together → keep
    name: String,
    avatarUrl: String,
  },
  createdAt: { type: Date, default: Date.now },
});

// after — briven/schema.ts
import { boolean, bigint, jsonb, schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  posts: table({
    columns: {
      id:        text().primaryKey(),
      authorId:  text().notNull().references('users', 'id'),
      title:     text().notNull(),
      body:      text().notNull(),
      published: boolean().notNull().default('false'),
      views:     bigint().notNull().default('0'),
      // tags: unbounded array — flatten to a separate post_tags table.
      // embedded author profile stays as jsonb (typed, read-with-parent).
      author:    jsonb<{ name: string; avatarUrl: string }>().notNull(),
      createdAt: timestamp().notNull().default('now()'),
    },
  }),
  post_tags: table({
    columns: {
      id:     text().primaryKey(),
      postId: text().notNull().references('posts', 'id'),
      tag:    text().notNull(),
    },
    indexes: [{ columns: ['postId'], unique: false }, { columns: ['tag'], unique: false }],
  }),
});`}</Snippet>
        <ul className="list-disc pl-5">
          <li>
            <code>ObjectId</code> → <code>text()</code>. mint new ids via{' '}
            <code>ulid(&apos;<em>prefix</em>&apos;)</code> in function code (sorts lexicographically
            by creation, which most callers want). if you need to preserve existing object ids
            for backwards compatibility with clients, keep them as text — the dump step below
            stringifies ObjectIds.
          </li>
          <li>
            <code>Number</code> → <code>bigint()</code>. mongo&apos;s default 64-bit double works
            for counters; briven&apos;s bigint avoids overflow on long-running tallies.
          </li>
          <li>
            <code>Date</code> → <code>timestamp()</code>. unix-ms <code>Date</code> values
            round-trip via <code>--date_oid_dates</code> in <code>mongoexport</code>.
          </li>
          <li>
            <code>[String]</code> / <code>[ObjectId]</code> arrays — flatten to a join table.
            postgres arrays exist but cost you index-able query support; the join table is
            cheaper and more obvious.
          </li>
        </ul>
      </Section>

      <Section title="data export from mongodb">
        <p>
          mongo doesn&apos;t natively output rows — you go through json. the canonical sequence:
        </p>
        <Snippet>{`# 1. export each collection to JSON (one doc per line)
mongoexport \\
  --uri="$MONGO_URI" \\
  --collection=posts \\
  --out=posts.json \\
  --jsonArray

# 2. transform the JSON into postgres COPY-compatible CSV.
# this step is custom per collection — a small node script that:
#   - flattens embedded docs into jsonb columns
#   - emits join-table rows for unbounded arrays
#   - stringifies ObjectIds
#   - converts mongo's $date / $oid extended-json into postgres values
# see: docs/migration/scripts/mongo-to-csv.ts (template)

# 3. load with COPY against the briven project dsn
psql "$BRIVEN_PROJECT_DSN" -c "\\copy posts FROM 'posts.csv' CSV HEADER"
psql "$BRIVEN_PROJECT_DSN" -c "\\copy post_tags FROM 'post_tags.csv' CSV HEADER"`}</Snippet>
        <p>
          the transform script is the migration. budget a day per non-trivial collection — the
          rules for which fields fold into <code>jsonb</code> vs flatten are decisions you make
          once and codify in the script.
        </p>
      </Section>

      <Section title="functions port — find/aggregate → ctx.db chains">
        <Snippet>{`// before — mongoose
const recent = await Post.find({ authorId, published: true })
  .select({ title: 1, body: 1, createdAt: 1 })
  .sort({ createdAt: -1 })
  .limit(50);

// after — briven/functions/recentPostsByAuthor.ts
import { brivenError, query, type Ctx } from '@briven/cli/server';
interface Args { authorId: string; limit?: number }
export default query(async (ctx: Ctx, args: Args) => {
  if (!args.authorId)
    throw new brivenError('validation_failed', 'authorId required', { status: 400 });
  return ctx
    .db('posts')
    .select(['id', 'title', 'body', 'createdAt'])
    .where({ authorId: args.authorId, published: true })
    .orderBy('createdAt', 'desc')
    .limit(Math.min(args.limit ?? 50, 200));
});`}</Snippet>
        <ul className="list-disc pl-5">
          <li>
            <strong>aggregate pipelines</strong> → either chain in the query-builder (group-by /
            having lives there) or drop into raw sql via <code>ctx.db.raw(...)</code>. complex
            pipelines often read better as a sql CTE; the migration is the right time to rewrite.
          </li>
          <li>
            <strong>$lookup joins</strong> → either run two queries inside the same function
            (single transaction; identical consistency) or use a raw join. mongo apps that
            relied on $lookup heavily tend to over-flatten in mongo — the briven port is a
            chance to fix the model.
          </li>
          <li>
            <strong>upserts</strong> → no first-class helper today; raw sql{' '}
            <code>INSERT ... ON CONFLICT</code>. an upsert helper on <code>ctx.db</code> is queued.
          </li>
          <li>
            <strong>transactions</strong> → every <code>mutation()</code> body is a single
            transaction by default. mongo&apos;s <code>session.withTransaction</code> blocks map
            1:1 — drop the session arg.
          </li>
        </ul>
      </Section>

      <Section title="auth port">
        <p>
          mongo apps usually run auth on top of the same database (
          <Link href="/migration/nextauth" className="underline underline-offset-2">nextauth</Link>
          &apos;s mongo adapter, lucia&apos;s mongo adapter, or a hand-rolled session collection).
          the schema maps to better-auth&apos;s shape one collection at a time — same drill as the
          drizzle/prisma ports.
        </p>
      </Section>

      <Section title="reactivity (new capability)">
        <p>
          mongo apps use change streams for reactive reads. on briven, wrap a read as{' '}
          <code>query()</code> and the same call from <code>@briven/react</code>&apos;s{' '}
          <code>useQuery</code> auto-refetches on table-level NOTIFYs — no change-stream
          subscription, no oplog reader, no per-document filter handling.
        </p>
      </Section>

      <Section title="parallel-run window — non-negotiable">
        <p>
          mongo → relational migrations almost always surface a shape mismatch in week 2 (the
          field you thought was optional is required for some old document set, or vice versa).
          plan a minimum 14-day parallel run before traffic flips. budget time to fix the
          transform script and re-import; the briven schema rarely needs to change.
        </p>
      </Section>
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
