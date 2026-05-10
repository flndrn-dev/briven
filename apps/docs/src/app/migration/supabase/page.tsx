import Link from 'next/link';

import { DocsShell } from '../../../components/shell';

export const metadata = { title: 'migration · supabase → briven' };

export default function SupabaseMigrationPage() {
  return (
    <DocsShell>
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        <Link href="/migration" className="hover:text-[var(--color-text)]">
          ← migration
        </Link>
      </p>
      <h1 className="mt-2 font-mono text-2xl tracking-tight">supabase → briven</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        port a supabase project onto briven. follow the ten-step playbook on{' '}
        <Link href="/migration" className="underline underline-offset-2">
          /migration
        </Link>{' '}
        — this page documents the supabase-specific parts (RLS, edge functions, auth, storage).
      </p>

      <div className="mt-6 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <strong>good news:</strong> supabase is already postgres. the schema port is mostly
        copy-paste; only RLS + edge functions + auth need real work.
      </div>

      <Section title="schema port — postgres → briven dsl">
        <p>
          dump your public schema and translate the <code>CREATE TABLE</code> statements
          one-to-one into the briven dsl. the column types map directly:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <code>text</code> / <code>varchar(n)</code> / <code>integer</code> /{' '}
            <code>bigint</code> / <code>boolean</code> / <code>timestamptz</code> /{' '}
            <code>uuid</code> / <code>jsonb</code> all have direct briven dsl equivalents (see{' '}
            <Link href="/schema" className="underline underline-offset-2">
              /schema
            </Link>
            ).
          </li>
          <li>
            <code>SERIAL</code> / <code>BIGSERIAL</code> → use a ulid <code>text().primaryKey()</code>{' '}
            with <code>newId(&apos;...&apos;)</code> from <code>@briven/shared</code> rather than a
            sequence; this is the briven idiom and avoids the &quot;IDs visible to attackers&quot;
            class of bugs.
          </li>
          <li>
            postgres enums (<code>CREATE TYPE ...</code>) → <code>text()</code> with
            application-level validation. the briven dsl doesn&apos;t have a first-class enum
            yet; the validation pattern stays in your function code.
          </li>
        </ul>
      </Section>

      <Section title="row-level-security policies do NOT carry over">
        <p>
          briven enforces tenancy in <strong>function code</strong>, not via postgres RLS. this
          is a deliberate trade-off — RLS is brittle when you have to reason about which role
          a query is running as, and the connection-pool model briven uses runs every query
          as the project&apos;s own role rather than the end-user&apos;s.
        </p>
        <p>port each <code>CREATE POLICY</code> to a guard inside your function:</p>
        <Snippet>{`-- supabase
CREATE POLICY "users see own notes"
ON notes FOR SELECT
USING (auth.uid() = author_id);

// briven/functions/getNotes.ts
import { query, type Ctx } from '@briven/cli/server';
export default query(async (ctx: Ctx) => {
  if (!ctx.auth) throw new Error('unauthorized');
  return await ctx.db('notes')
    .select()
    .where({ authorId: ctx.auth.userId });
});`}</Snippet>
        <p>
          this is more code per query but easier to reason about, easier to log, and easier to
          test. side benefit: no policy-recompile pause on a schema change.
        </p>
      </Section>

      <Section title="edge functions port">
        <p>
          supabase edge functions are deno scripts; briven functions are also deno isolates
          (see <Link href="/functions" className="underline underline-offset-2">/functions</Link>
          ). the wire format is different (briven functions are invoked via{' '}
          <code>POST /v1/projects/:id/functions/:name</code>, not over a custom edge runtime),
          but the handler shape ports cleanly:
        </p>
        <Snippet>{`// supabase: supabase/functions/sendInvite/index.ts
serve(async (req) => {
  const { email, role } = await req.json();
  // ... call mittera, write to db ...
  return new Response(JSON.stringify({ ok: true }));
});

// briven: briven/functions/sendInvite.ts
import { mutation, type Ctx } from '@briven/cli/server';
import { z } from 'zod';

const Args = z.object({ email: z.string().email(), role: z.string() });

export default mutation(async (ctx: Ctx, raw: unknown) => {
  const { email, role } = Args.parse(raw);
  // ... call mittera (signing secret in ctx.env), write to db ...
  return { ok: true };
});`}</Snippet>
      </Section>

      <Section title="auth port">
        <p>
          supabase auth → Better Auth. briven supports magic-link + email/password + GitHub
          OAuth out of the box. supabase&apos;s{' '}
          <code>auth.users</code> table doesn&apos;t exist on briven — there&apos;s a single{' '}
          <code>users</code> table with email + name + verifiedAt.
        </p>
        <p>
          to preserve user IDs across the cut, set briven&apos;s <code>users.id</code> to
          supabase&apos;s <code>auth.users.id</code> (it&apos;s a uuid; briven&apos;s text
          primary key accepts it directly) during the data-import step.
        </p>
      </Section>

      <Section title="storage port">
        <p>
          supabase storage → MinIO (briven.tech) or any S3-compatible bucket (self-host).
          the path layout briven uses is <code>p_&lt;projectId&gt;/&lt;userPath&gt;</code> —
          your existing bucket can be cp&apos;d wholesale into the new namespace.{' '}
          <code>briven storage</code> as a CLI command lands with the public beta; until then
          use the AWS or rclone CLIs against the briven minio endpoint.
        </p>
      </Section>

      <Section title="data dump → briven">
        <p>
          supabase exposes a postgres connection on the dashboard. dump the public schema,
          restore into the briven project&apos;s schema:
        </p>
        <Snippet>{`# dump
pg_dump --schema=public --no-owner --no-privileges \\
  --format=custom --file=supabase.dump \\
  "$SUPABASE_DATABASE_URL"

# restore — connect with the dsn from \`briven db shell-token\`
pg_restore --no-owner --no-privileges \\
  --schema=public --dbname="$BRIVEN_PROJECT_DSN" \\
  supabase.dump

# briven's data plane creates a per-project schema (proj_<id>); the
# above restore writes into "public" inside that schema. adjust
# search_path if your queries assume bare table names.`}</Snippet>
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
