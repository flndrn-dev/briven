import Link from 'next/link';

import { DocsShell } from '../../../components/shell';

export const metadata = { title: 'migration · firebase → briven' };

export default function FirebaseMigrationPage() {
  return (
    <DocsShell>
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        <Link href="/migration" className="hover:text-[var(--color-text)]">
          ← migration
        </Link>
      </p>
      <h1 className="mt-2 font-mono text-2xl tracking-tight">firebase → briven</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        the hardest path. firebase is a document database, firebase auth is its own world,
        firebase storage is GCS. briven is postgres + Better Auth + S3-compatible. plan a
        2+ week parallel-run window.
      </p>

      <div className="mt-6 rounded-md border border-[var(--color-text-error)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <strong>read this first:</strong> firebase migrations expose document-shape mismatches
        that don&apos;t show up in unit tests. if you have a firestore field that&apos;s
        sometimes a string and sometimes a number, it lives across two columns on briven —
        catch this in step 1 of the playbook (inventory) by sampling 1k rows per collection
        and noting every field&apos;s observed types.
      </div>

      <Section title="document → relational remap">
        <p>three patterns cover most firestore collections:</p>
        <ul className="list-disc pl-5">
          <li>
            <strong>flat collection</strong> — every document has the same shape. trivial: one
            briven table, one column per field. denormalised <code>map</code> fields can become
            either <code>jsonb()</code> (when you don&apos;t query inside) or sibling columns
            (when you do).
          </li>
          <li>
            <strong>subcollection</strong> — <code>users/&lt;uid&gt;/notes/&lt;noteId&gt;</code>{' '}
            becomes a child table with a foreign key to the parent.{' '}
            <code>userId text().references(&apos;users&apos;, &apos;id&apos;)</code>. queries change shape
            (from <code>collection(db, &apos;users&apos;, uid, &apos;notes&apos;)</code> to{' '}
            <code>ctx.db(&apos;notes&apos;).where({`{ userId }`})</code>) but the security model
            is clearer.
          </li>
          <li>
            <strong>polymorphic union</strong> — a single collection where{' '}
            <code>type</code> drives which fields are populated. either:
            (a) one table with all union-shaped columns nullable, or
            (b) a base table + per-type child tables joined by{' '}
            <code>id</code>. (a) is faster to migrate; (b) is tighter to maintain. pick (a) for
            year-one and revisit.
          </li>
        </ul>
      </Section>

      <Section title="schema sketch">
        <p>
          firestore <code>users/&lt;uid&gt;</code> + <code>users/&lt;uid&gt;/notes/&lt;noteId&gt;</code>:
        </p>
        <Snippet>{`// firestore (informal)
users/<uid> = {
  email: string,
  displayName?: string,
  preferences: { theme: 'light' | 'dark', density: 'compact' | 'comfy' },
  createdAt: Timestamp,
}

users/<uid>/notes/<noteId> = {
  body: string,
  archived?: boolean,
  authorId: ref('users/<uid>'),  // implicit in firestore
  createdAt: Timestamp,
}

// briven
import { bigint, boolean, jsonb, schema, table, text } from '@briven/cli/schema';

interface Preferences {
  theme: 'light' | 'dark';
  density: 'compact' | 'comfy';
}

export default schema({
  users: table({
    columns: {
      id: text().primaryKey(),
      email: text().notNull(),
      displayName: text(),
      preferences: jsonb<Preferences>().notNull().default("'{}'"),
      createdAt: bigint().notNull(),
    },
    indexes: [{ columns: ['email'], unique: true }],
  }),
  notes: table({
    columns: {
      id: text().primaryKey(),
      userId: text().notNull().references('users', 'id'),
      body: text().notNull(),
      archived: boolean().notNull().default('false'),
      createdAt: bigint().notNull(),
    },
    indexes: [{ columns: ['userId', 'createdAt'] }],
  }),
});`}</Snippet>
      </Section>

      <Section title="data export — firestore → briven">
        <p>
          firebase&apos;s admin SDK can stream a collection as ndjson. write a one-shot node
          script that walks every collection and pushes into briven via the cli&apos;s
          <code> briven db shell-token</code> dsn:
        </p>
        <Snippet>{`// migrate.ts
import admin from 'firebase-admin';
import postgres from 'postgres';
import { execSync } from 'node:child_process';

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const dsn = execSync('briven db shell-token').toString().trim();
const sql = postgres(dsn);

const usersSnap = await admin.firestore().collection('users').get();
for (const doc of usersSnap.docs) {
  const data = doc.data();
  await sql\`
    INSERT INTO users (id, email, display_name, preferences, created_at)
    VALUES (\${doc.id}, \${data.email}, \${data.displayName ?? null},
            \${JSON.stringify(data.preferences ?? {})},
            \${data.createdAt.toMillis()})
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      preferences = EXCLUDED.preferences
  \`;
  // Stream subcollections.
  const notesSnap = await doc.ref.collection('notes').get();
  for (const note of notesSnap.docs) {
    const n = note.data();
    await sql\`
      INSERT INTO notes (id, user_id, body, archived, created_at)
      VALUES (\${note.id}, \${doc.id}, \${n.body}, \${n.archived ?? false},
              \${n.createdAt.toMillis()})
      ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, archived = EXCLUDED.archived
    \`;
  }
}
await sql.end();
console.log('done');`}</Snippet>
        <p>
          run it twice during the parallel-run window — first to seed, then again right
          before cutover to pick up writes that landed on firestore in the meantime.{' '}
          <code>ON CONFLICT DO UPDATE</code> makes both runs idempotent.
        </p>
      </Section>

      <Section title="auth port">
        <p>
          firebase auth → Better Auth. preserve <code>users.id</code> by passing the
          firebase <code>uid</code> as the briven user id during the export above. the cutover
          is a forced sign-in: users keep their email, get a fresh session.
        </p>
        <p>
          if you used firebase&apos;s phone auth, briven doesn&apos;t have a first-class phone
          provider yet. plan to migrate phone-only users to email-or-magic-link before the
          cutover.
        </p>
      </Section>

      <Section title="storage port">
        <p>
          firebase storage is GCS. briven cloud uses MinIO; self-host is whatever
          S3-compatible bucket you point it at. <code>gsutil rsync</code> from your firestore
          bucket into a fresh briven bucket; the path layout is a free choice — keep your
          existing prefix structure and update your function code to read from{' '}
          <code>${`{projectId}/${`oldPrefix`}/${`...`}`}</code>.
        </p>
      </Section>

      <Section title="reactivity port">
        <p>
          firestore&apos;s <code>onSnapshot</code> → briven&apos;s{' '}
          <code>useQuery(&quot;getThing&quot;, args)</code>. shapes are similar; the
          differences:
        </p>
        <ul className="list-disc pl-5">
          <li>
            firestore subscribes to a query path; briven subscribes to a function. write the
            function once, every client uses it.
          </li>
          <li>
            firestore returns <code>QuerySnapshot</code> with per-document change events;
            briven returns the function&apos;s full return value on every NOTIFY. for
            high-fanout collections, this means more bytes over the wire — diff client-side
            if it matters, or paginate the function.
          </li>
        </ul>
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
