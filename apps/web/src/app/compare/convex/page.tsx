import type { Metadata } from 'next';

import { ComparePage } from '../../../components/marketing/compare-page';
import { getSessionUser } from '../../../lib/session';

export const metadata: Metadata = {
  title: 'briven vs convex — feature comparison',
  description:
    'briven vs convex: reactive queries on plain postgres vs convex&apos;s proprietary engine. honest tradeoffs.',
};

const ROWS = [
  {
    feature: 'database',
    briven: 'plain postgres 17 + pgvector. pg_dump is your escape hatch.',
    other: "proprietary engine. exports to json but you can't pg_dump out.",
  },
  {
    feature: 'query language',
    briven: 'typed query functions with auto-generated client. raw sql when you want it.',
    other: 'typed convex functions; no raw sql.',
  },
  {
    feature: 'reactive subscriptions',
    briven: 'listen/notify-based reactive queries on real postgres tables.',
    other: 'first-class reactive queries (the pattern briven adopts).',
  },
  {
    feature: 'self-host',
    briven: 'agpl-3.0 core. self-host the full engine on your own postgres.',
    other: 'no self-host. cloud-only.',
  },
  {
    feature: 'pricing',
    briven: '€0 free, €29 pro, €99 team. or free self-hosted forever.',
    other: 'free tier + usage-based; team plan $25/mo + bandwidth + functions metering.',
  },
  {
    feature: 'export',
    briven: 'one command (`briven export`) gives you the whole project as pg_dump + bundles.',
    other: 'json export of records. functions and schema do not export.',
  },
  {
    feature: 'sql access',
    briven: 'sql editor in studio. psql from the cli. postgres clients connect directly.',
    other: 'no sql access. queries go through convex functions only.',
  },
  {
    feature: 'open source',
    briven: 'agpl-3.0 engine, mit cli + sdks. development happens in public.',
    other: 'closed source. cli + client sdks are open.',
  },
  {
    feature: 'auth',
    briven: 'better-auth with magic link, oauth (google/github/discord), email+password built in.',
    other: 'convex auth via clerk, auth0, or custom provider integration.',
  },
  {
    feature: 'file storage',
    briven: 'minio (s3-compatible) bundled. point at your own s3/r2 in self-host.',
    other: 'convex file storage (own engine).',
  },
];

const WHEN_OTHER_WINS = [
  'you want a fully managed nosql-like store with zero postgres concepts to learn.',
  'you prefer convex&apos;s richer ecosystem of templates, hosted demos, and pre-built integrations.',
  'you need the convex action runtime&apos;s specific timing characteristics (we&apos;re close, but not bit-identical).',
];

const WHEN_BRIVEN_WINS = [
  'you want your data in real postgres, exportable any day with pg_dump.',
  'you want to self-host. briven runs anywhere docker runs; convex doesn&apos;t self-host.',
  'you need sql, materialised views, triggers, extensions, or any other postgres feature.',
  'you care about data residency. briven runs in eu, single-region, on your hardware if you want.',
  'you want a flat fee, not usage-based pricing surprises.',
];

export default async function ConvexComparePage() {
  const user = await getSessionUser().catch(() => null);
  return (
    <ComparePage
      user={user}
      otherName="convex"
      oneline="reactive queries on plain postgres, not a proprietary engine."
      intro="convex pioneered the reactive-queries pattern briven adopts. the difference is the floor: convex stores your data in its own engine, briven stores it in plain postgres. that one decision changes everything downstream — exports, self-host, sql access, data residency."
      rows={ROWS}
      whenOtherWins={WHEN_OTHER_WINS}
      whenBrivenWins={WHEN_BRIVEN_WINS}
      migrationGuideHref="https://docs.briven.tech/migration/convex"
    />
  );
}
