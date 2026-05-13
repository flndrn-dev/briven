import type { Metadata } from 'next';

import { ComparePage } from '../../../components/marketing/compare-page';
import { getSessionUser } from '../../../lib/session';

export const metadata: Metadata = {
  title: 'briven vs supabase — feature comparison',
  description:
    'briven vs supabase: typed function layer + reactive queries vs postgrest + row-level security. both run on postgres.',
};

const ROWS = [
  {
    feature: 'database',
    briven: 'postgres 17 + pgvector. one schema per project.',
    other: 'postgres 15/16 + pgvector. one schema per project.',
  },
  {
    feature: 'data access',
    briven: 'typed query/mutation functions. the client only calls function names.',
    other: 'postgrest exposes tables directly; the client constructs queries.',
    note: 'biggest architectural difference between the two.',
  },
  {
    feature: 'authorization',
    briven: 'server-side function logic with project-scoped connections.',
    other: 'row-level security policies in postgres + jwt claims.',
  },
  {
    feature: 'reactive queries',
    briven: 'listen/notify-based reactive subscriptions, deduped + cached server-side.',
    other: 'realtime via wal replication; subscribe-to-changes, not subscribe-to-queries.',
  },
  {
    feature: 'schema migrations',
    briven: '`briven deploy` diffs schema.ts against live db, applies transactionally.',
    other: 'sql migration files via supabase cli or your tool of choice.',
  },
  {
    feature: 'auth',
    briven: 'better-auth with magic link, oauth (google/github/discord), email+password.',
    other: 'gotrue with the same providers + sso + mfa.',
  },
  {
    feature: 'file storage',
    briven: 'minio bundled (s3-compatible). point at your own s3/r2 self-hosted.',
    other: 'supabase storage built on s3.',
  },
  {
    feature: 'edge functions',
    briven: 'deno runtime per project, warm-cached. one isolate per project.',
    other: 'supabase edge functions via deno deploy.',
  },
  {
    feature: 'self-host',
    briven: 'agpl-3.0 core, single compose file, runs anywhere docker runs.',
    other: 'apache 2.0, supabase self-host stack is ~12 containers but well-documented.',
  },
  {
    feature: 'pricing',
    briven: '€0 free, €29 pro, €99 team. flat fees, no compute surprises.',
    other: '$0 free, $25 pro + usage. compute add-ons billed separately.',
  },
];

const WHEN_OTHER_WINS = [
  'you want postgrest&apos;s rest api directly — generated openapi spec, query builder in the client, etc.',
  'you have a large supabase migration already and the cost of moving outweighs the gains.',
  'you need first-class row-level security as your security boundary (briven uses functions instead).',
  'you want supabase&apos;s pgrest tooling: pg_graphql, pg_hooks, native postgrest features.',
];

const WHEN_BRIVEN_WINS = [
  'you want typed function calls instead of building queries on the client.',
  'you want convex-style reactive queries (subscribe to a query, get pushed updates when underlying tables change).',
  'you want a one-command export of your entire project (pg_dump + functions + env), portable to any host.',
  'you want a simpler self-host story — one compose file, three containers in the minimal mode.',
];

export default async function SupabaseComparePage() {
  const user = await getSessionUser().catch(() => null);
  return (
    <ComparePage
      user={user}
      otherName="supabase"
      oneline="typed functions + reactive queries on the same postgres."
      intro="both briven and supabase run on real postgres. the architectural split is at the api layer: supabase exposes the database via postgrest with row-level security, briven puts a typed function layer in front and adds query-level reactive subscriptions that supabase doesn&apos;t have."
      rows={ROWS}
      whenOtherWins={WHEN_OTHER_WINS}
      whenBrivenWins={WHEN_BRIVEN_WINS}
      migrationGuideHref="https://docs.briven.tech/migration/supabase"
    />
  );
}
