import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { apiFetch } from '../../../../../../../lib/api';
import { requireUser } from '../../../../../../../lib/session';

export const metadata = { title: 'migrate to briven' };

interface SourceDetail {
  slug: string;
  name: string;
  urlLabel: string;
  urlPlaceholder: string;
  urlHelp: string;
  highlights: readonly string[];
  // Honest framing of the path. Shown verbatim on the page.
  pathDescription: string;
}

// Per-source detail copy. Keep the highlights short — these are
// reassurance bullets for a non-technical reader, not docs. The
// /migration/<source> docs page covers the engineering depth.
const SOURCES: Record<string, SourceDetail> = {
  convex: {
    slug: 'convex',
    name: 'convex',
    urlLabel: 'convex deployment URL',
    urlPlaceholder: 'https://my-deployment.convex.cloud',
    urlHelp: 'find this in your convex dashboard under settings → deployment URL',
    highlights: [
      'your TS schema ports to briven schema DSL — we map the 12 type primitives',
      'query / mutation / action handlers keep the same names in briven',
      'useQuery() on the client matches convex 1:1 — your React tree barely changes',
    ],
    pathDescription:
      'we read your schema, port it to briven, copy your data via convex export, and translate the handlers we can. anything we can’t auto-port we flag for you to review.',
  },
  supabase: {
    slug: 'supabase',
    name: 'supabase',
    urlLabel: 'supabase project URL',
    urlPlaceholder: 'https://xxxx.supabase.co',
    urlHelp: 'find this in your supabase dashboard under settings → API',
    highlights: [
      'data move is free — postgres → postgres via pg_dump | pg_restore',
      'edge functions (deno) port directly to briven functions',
      'RLS policies become guard checks inside your function code',
    ],
    pathDescription:
      'we pg_dump your supabase database, restore it into briven, port your edge functions, and rewrite your RLS as briven function guards.',
  },
  firebase: {
    slug: 'firebase',
    name: 'firebase / firestore',
    urlLabel: 'firebase project ID',
    urlPlaceholder: 'my-firebase-project',
    urlHelp: 'find this in firebase console → project settings',
    highlights: [
      'document → relational is a modelling decision — we propose, you approve',
      'firebase auth users map to Better Auth, preserving provider+subject pairs',
      'realtime listeners migrate to briven’s reactive useQuery hook',
    ],
    pathDescription:
      'document stores need a shape decision per collection: flatten into columns vs jsonb blob vs hybrid. we sample your data and propose a schema; you review every collection before we commit.',
  },
  mongodb: {
    slug: 'mongodb',
    name: 'mongodb',
    urlLabel: 'mongodb connection string',
    urlPlaceholder: 'mongodb+srv://...',
    urlHelp: 'paste a read-only connection string with admin access to your db',
    highlights: [
      'collection-by-collection shape decisions (flatten vs jsonb)',
      'ObjectId → text columns with ULID for new rows',
      'aggregation pipelines port to ctx.db chains or postgres views',
    ],
    pathDescription:
      'we mongoexport each collection, propose a relational schema (flatten vs jsonb per field), and transform via a streaming COPY into postgres.',
  },
  drizzle: {
    slug: 'drizzle',
    name: 'drizzle',
    urlLabel: 'database connection string',
    urlPlaceholder: 'postgres://...',
    urlHelp: 'briven uses postgres — same shape as drizzle’s pg adapter',
    highlights: [
      'the lightest migration of any source — drizzle and briven both target postgres',
      'schema.ts ports almost 1:1 (we map column-builder calls)',
      'your data moves via pg_dump | pg_restore — no transform step',
    ],
    pathDescription:
      'we swap your drizzle schema for briven’s DSL (very similar shape), point pg_dump at your db, and restore into the briven data plane. your queries change import, not semantics.',
  },
  prisma: {
    slug: 'prisma',
    name: 'prisma',
    urlLabel: 'database connection string',
    urlPlaceholder: 'postgres://...',
    urlHelp: 'the DATABASE_URL from your prisma .env',
    highlights: [
      'schema.prisma → briven schema DSL via our translator',
      'PrismaClient calls become ctx.db chains (similar fluent shape)',
      'your data carries over via pg_dump | pg_restore',
    ],
    pathDescription:
      'we parse your schema.prisma, emit briven/schema.ts, port your service code (PrismaClient → ctx.db), and pg_dump the data.',
  },
  postgres: {
    slug: 'postgres',
    name: 'raw postgres',
    urlLabel: 'database connection string',
    urlPlaceholder: 'postgres://...',
    urlHelp: 'admin DSN with read access to every table you want to migrate',
    highlights: [
      'the straightest path — both ends are postgres',
      'schema.sql → briven schema DSL via the introspection script',
      'no auth port (briven is the auth layer; bring your own if you have one)',
    ],
    pathDescription:
      'we introspect your schema, port it to briven’s DSL, pg_dump | pg_restore the data, and help you write the briven functions that replace whatever service was reading/writing this database.',
  },
  hasura: {
    slug: 'hasura',
    name: 'hasura',
    urlLabel: 'hasura endpoint URL',
    urlPlaceholder: 'https://myproject.hasura.app/v1/graphql',
    urlHelp: 'the GraphQL endpoint from your hasura console',
    highlights: [
      'the postgres half ports for free via pg_dump',
      'every (role, table, action) permission becomes a guard in function code',
      'GraphQL endpoint replaced by typed briven functions',
    ],
    pathDescription:
      'data moves via pg_dump. the bulk of the work is the permissions port: every hasura metadata rule becomes an explicit check inside the briven function that replaces it.',
  },
  nextauth: {
    slug: 'nextauth',
    name: 'nextauth / auth.js',
    urlLabel: 'database connection string',
    urlPlaceholder: 'postgres://... (your nextauth db)',
    urlHelp: 'the database where your nextauth tables live',
    highlights: [
      'schema maps 1:1 — both target Better Auth’s table shape',
      'OAuth providers carry over (we re-link by provider+subject)',
      'choice: preserve session IDs, or one-time fresh sign-in',
    ],
    pathDescription:
      'we copy your user / account / session tables (already Better Auth shape), wire up your OAuth providers, and replace getServerSession / useSession callsites with briven’s session helpers.',
  },
};

async function submitMigrationRequest(formData: FormData) {
  'use server';
  const source = String(formData.get('source') ?? '');
  const sourceUrl = String(formData.get('sourceUrl') ?? '').trim();
  const sourceNotes = String(formData.get('sourceNotes') ?? '').trim();
  const estimatedTables = String(formData.get('estimatedTables') ?? '').trim();
  const estimatedRows = String(formData.get('estimatedRows') ?? '').trim();
  const estimatedFunctions = String(formData.get('estimatedFunctions') ?? '').trim();
  const urgency = String(formData.get('urgency') ?? 'exploring');
  const contactEmail = String(formData.get('contactEmail') ?? '').trim();

  const res = await apiFetch('/v1/migration-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source,
      sourceUrl: sourceUrl || null,
      sourceNotes,
      estimatedTables: estimatedTables ? Number(estimatedTables) : null,
      estimatedRows: estimatedRows || null,
      estimatedFunctions: estimatedFunctions ? Number(estimatedFunctions) : null,
      urgency,
      contactEmail,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`migration request failed (${res.status}): ${body}`);
  }

  redirect('/dashboard/projects/new/migrate/thanks');
}

export default async function MigrateSourcePage({
  params,
}: {
  params: Promise<{ source: string }>;
}) {
  const { source } = await params;
  const detail = SOURCES[source];
  if (!detail) notFound();
  const user = await requireUser();

  return (
    <section className="max-w-2xl">
      <p className="mb-4 font-mono text-xs text-[var(--color-text-muted)]">
        <Link href="/dashboard/projects/new" className="hover:text-[var(--color-text)]">
          ← back
        </Link>
      </p>
      <header className="mb-8">
        <h1 className="font-mono text-xl tracking-tight">
          migrate from{' '}
          <span className="text-[var(--color-primary)]">{detail.name}</span>
        </h1>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          {detail.pathDescription}
        </p>
      </header>

      <div className="mb-8 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
        <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          what we handle for you
        </p>
        <ul className="mt-2 flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
          {detail.highlights.map((h) => (
            <li key={h} className="flex gap-2">
              <span className="text-[var(--color-primary)]">·</span>
              <span>{h}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-8 rounded-md border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] p-4 font-mono text-xs text-[var(--color-text)]">
        <strong>your {detail.name} stays untouched.</strong>{' '}
        <span className="text-[var(--color-text-muted)]">
          we only read from it. nothing is moved, deleted, or modified on your source until
          you press the cutover button — which we won&apos;t do until you say so.
        </span>
      </div>

      <form action={submitMigrationRequest} className="flex flex-col gap-5">
        <input type="hidden" name="source" value={detail.slug} />

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            {detail.urlLabel}{' '}
            <span className="text-[var(--color-text-subtle)]">(optional)</span>
          </span>
          <input
            name="sourceUrl"
            type="text"
            maxLength={2000}
            placeholder={detail.urlPlaceholder}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          />
          <span className="font-mono text-[11px] text-[var(--color-text-subtle)]">
            {detail.urlHelp}
          </span>
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-mono text-xs text-[var(--color-text-muted)]">
            rough scale{' '}
            <span className="text-[var(--color-text-subtle)]">(estimates are fine)</span>
          </legend>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                tables / collections
              </span>
              <input
                name="estimatedTables"
                type="number"
                min={0}
                max={10000}
                placeholder="12"
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                total rows / documents
              </span>
              <input
                name="estimatedRows"
                type="number"
                min={0}
                placeholder="500000"
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                functions / handlers
              </span>
              <input
                name="estimatedFunctions"
                type="number"
                min={0}
                max={10000}
                placeholder="18"
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
              />
            </label>
          </div>
        </fieldset>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            anything else we should know{' '}
            <span className="text-[var(--color-text-subtle)]">
              (auth provider, special requirements, deadlines, etc.)
            </span>
          </span>
          <textarea
            name="sourceNotes"
            rows={5}
            maxLength={8000}
            placeholder="we use clerk for auth, ~50 daily active users, want to cut over before next launch on the 21st."
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            urgency
          </span>
          <select
            name="urgency"
            defaultValue="exploring"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          >
            <option value="exploring">just exploring · no rush</option>
            <option value="this_quarter">this quarter</option>
            <option value="this_month">this month</option>
            <option value="this_week">this week · time-sensitive</option>
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            contact email
          </span>
          <input
            name="contactEmail"
            type="email"
            required
            maxLength={320}
            defaultValue={user.email}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          />
          <span className="font-mono text-[11px] text-[var(--color-text-subtle)]">
            we&apos;ll reach out within one business day to walk you through next steps.
          </span>
        </label>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
          >
            request migration · free during beta
          </button>
          <Link
            href="/dashboard/projects/new"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 font-mono text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
