import type { Metadata } from 'next';

import { ComparePage } from '../../../components/marketing/compare-page';
import { getSessionUser } from '../../../lib/session';

export const metadata: Metadata = {
  title: 'briven vs firebase — feature comparison',
  description:
    'briven vs firebase: real sql on postgres vs firestore documents. when you outgrow nosql.',
};

const ROWS = [
  {
    feature: 'data model',
    briven: 'relational. tables, columns, foreign keys, transactions.',
    other: 'document. collections of json-like documents with nested subcollections.',
    note: 'the fundamental shape of your data lives here.',
  },
  {
    feature: 'query language',
    briven: 'sql, plus typed query functions. joins are free.',
    other: 'firestore queries; joins require fan-out reads or denormalisation.',
  },
  {
    feature: 'transactions',
    briven: 'postgres acid transactions. multi-table, multi-row, fully isolated.',
    other: 'firestore transactions limited to a small set of documents.',
  },
  {
    feature: 'reactive queries',
    briven: 'subscribe to a typed query; get pushed updates on any underlying-table change.',
    other: 'snapshot listeners on document/collection paths.',
  },
  {
    feature: 'security',
    briven: 'server-side typed functions with project-scoped db connections.',
    other: 'security rules evaluated on every request; runs on client query.',
  },
  {
    feature: 'export',
    briven: 'pg_dump. one command, the whole project.',
    other: 'firestore export to gcs. binary format, not directly importable elsewhere.',
  },
  {
    feature: 'self-host',
    briven: 'agpl-3.0. runs anywhere docker runs.',
    other: 'no self-host. google cloud only.',
  },
  {
    feature: 'auth',
    briven: 'better-auth with magic link, oauth, email+password — bundled.',
    other: 'firebase auth with broad oauth + phone auth + anonymous accounts.',
  },
  {
    feature: 'file storage',
    briven: 'minio (s3-compatible) bundled.',
    other: 'cloud storage for firebase (gcs underneath).',
  },
  {
    feature: 'pricing',
    briven: '€0 free, €29 pro, €99 team. flat fees, predictable.',
    other: 'pay-as-you-go: per read, per write, per delete, per gb. famously hard to predict.',
  },
];

const WHEN_OTHER_WINS = [
  'you&apos;re building a quick mobile prototype and want phone-number auth + offline-first sync out of the box.',
  'your data is genuinely document-shaped (nested, schemaless, varying per record).',
  'you&apos;re already on google cloud and want everything in one billing line.',
];

const WHEN_BRIVEN_WINS = [
  'you outgrew nosql and want joins, transactions, and a proper relational model.',
  'you want predictable monthly pricing instead of per-operation billing.',
  'you want your data in a format you can move anywhere (pg_dump → any postgres host).',
  'you want server-side authz logic in typescript, not security-rule dsl evaluated on each query.',
  'you need eu data residency or your own hardware.',
];

export default async function FirebaseComparePage() {
  const user = await getSessionUser().catch(() => null);
  return (
    <ComparePage
      user={user}
      otherName="firebase"
      oneline="when you outgrow nosql, briven is real sql with the same realtime ergonomics."
      intro="firebase shines at mobile prototypes and document-shaped data. once your data picks up relations, transactions, and predictable scale, briven is the postgres-shaped version of the same idea — typed queries, reactive subscriptions, server-side authz, and a bill you can predict."
      rows={ROWS}
      whenOtherWins={WHEN_OTHER_WINS}
      whenBrivenWins={WHEN_BRIVEN_WINS}
      migrationGuideHref="https://docs.briven.tech/migration/firebase"
    />
  );
}
