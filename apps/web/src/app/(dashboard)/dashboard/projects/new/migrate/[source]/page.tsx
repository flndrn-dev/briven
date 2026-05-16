import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiFetch } from '../../../../../../../lib/api';
import { requireUser } from '../../../../../../../lib/session';
import { MigrateForm } from './migrate-form';

type SubmitResult = { ok: true; redirectTo: string } | { ok: false; error: string };

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

async function submitMigrationRequest(input: {
  source: string;
  sourceUrl: string;
  sourceNotes: string;
  estimatedTables: string;
  estimatedRows: string;
  estimatedFunctions: string;
  urgency: string;
  contactEmail: string;
}): Promise<SubmitResult> {
  'use server';
  const res = await apiFetch('/v1/migration-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: input.source,
      sourceUrl: input.sourceUrl || null,
      sourceNotes: input.sourceNotes,
      estimatedTables: input.estimatedTables ? Number(input.estimatedTables) : null,
      estimatedRows: input.estimatedRows || null,
      estimatedFunctions: input.estimatedFunctions ? Number(input.estimatedFunctions) : null,
      urgency: input.urgency,
      contactEmail: input.contactEmail,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let message = body;
    try {
      const parsed = JSON.parse(body) as { message?: string };
      if (parsed.message) message = parsed.message;
    } catch {
      // body wasn't JSON
    }
    return { ok: false, error: message || `migration request failed: ${res.status}` };
  }

  return { ok: true, redirectTo: '/dashboard/projects/new/migrate/thanks' };
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

      <MigrateForm
        sourceSlug={detail.slug}
        sourceName={detail.name}
        urlLabel={detail.urlLabel}
        urlPlaceholder={detail.urlPlaceholder}
        urlHelp={detail.urlHelp}
        defaultEmail={user.email}
        submit={submitMigrationRequest}
      />
    </section>
  );
}
