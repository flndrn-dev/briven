import Link from 'next/link';

import { DocsShell } from '../../../components/shell';

export const metadata = { title: 'migration · nextauth → briven' };

export default function NextAuthMigrationPage() {
  return (
    <DocsShell>
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        <Link href="/migration" className="hover:text-[var(--color-text)]">
          ← migration
        </Link>
      </p>
      <h1 className="mt-2 font-mono text-2xl tracking-tight">nextauth → briven</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        moving from NextAuth (or Auth.js) to briven — which uses Better Auth under the hood.
        the protocols line up cleanly; the work is at the integration seam (your prisma adapter
        vs briven&apos;s schema, your getServerSession vs briven&apos;s client SDK). plan a
        2-3 day window for a single-app cutover.
      </p>

      <div className="mt-6 rounded-md border border-[var(--color-text-error)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <strong>read this first:</strong> the typical pitfall is forgetting that briven also
        owns the database. nextauth lives next to your db; briven IS the db boundary. you can
        keep your existing postgres, but the schema for users/accounts/sessions/verifications
        now lives in briven&apos;s control plane, not in your app. step 2 of the playbook is
        where this lands.
      </div>

      <Section title="account preservation">
        <p>
          two cutover shapes — pick one before you start:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <strong>preserve user ids</strong> (recommended): import your nextauth users into
            briven&apos;s <code>users</code> table with the existing ids. all your foreign
            keys keep working (<code>posts.userId</code> still resolves). users sign in fresh
            once after cutover. covered in step 3 of the playbook.
          </li>
          <li>
            <strong>preserve sessions</strong>: bridge nextauth sessions to briven for a
            window via a custom middleware. only worth it if you can&apos;t stomach a forced
            re-auth (consumer app with millions of active sessions). file a ticket — this path
            is supported but not self-service.
          </li>
        </ul>
      </Section>

      <Section title="provider port">
        <p>
          nextauth providers map to briven providers 1:1 — same OAuth endpoints, same scopes,
          same redirect URIs. you just register them on the briven side instead of in your
          nextauth config. supported on briven today:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <strong>magic link via email</strong> — drop-in for nextauth&apos;s{' '}
            <code>EmailProvider</code>. briven uses mittera.eu (configurable);{' '}
            <code>sendMagicLink</code> already wired.
          </li>
          <li>
            <strong>email + password</strong> — drop-in for nextauth&apos;s{' '}
            <code>CredentialsProvider</code> when you used password hashing. briven uses
            argon2id (better-auth default).
          </li>
          <li>
            <strong>Google OAuth</strong> — register a new client at console.cloud.google.com
            with redirect URI <code>https://api.briven.tech/v1/auth/callback/google</code>.
          </li>
          <li>
            <strong>GitHub OAuth</strong> — same shape, redirect URI{' '}
            <code>https://api.briven.tech/v1/auth/callback/github</code>.
          </li>
        </ul>
        <p>
          not supported yet (file a ticket if you&apos;re blocked on one): Apple, Twitter,
          Facebook, Discord. the underlying Better Auth library covers all of these — they
          just need a small wire-up patch.
        </p>
      </Section>

      <Section title="schema port">
        <p>
          nextauth&apos;s <code>users</code> / <code>accounts</code> / <code>sessions</code> /{' '}
          <code>verification_tokens</code> tables map 1:1 to briven&apos;s{' '}
          <code>users</code> / <code>accounts</code> / <code>sessions</code> /{' '}
          <code>verifications</code>. column names line up exactly because both libraries
          target the same Better Auth schema shape. import script:
        </p>
        <Snippet>{`-- inside the briven control-plane meta-db, after a fresh briven install
INSERT INTO users (id, email, email_verified, name, image, created_at)
SELECT id, email, email_verified IS NOT NULL, name, image, created_at
FROM nextauth_dump.users;

INSERT INTO accounts (id, user_id, provider_id, account_id, access_token,
                      refresh_token, scope, id_token, password)
SELECT id, user_id, provider, "providerAccountId", access_token,
       refresh_token, scope, id_token, NULL
FROM nextauth_dump.accounts;

-- sessions intentionally NOT imported; users sign in fresh after cutover.`}</Snippet>
      </Section>

      <Section title="api shape">
        <p>
          nextauth&apos;s <code>getServerSession(authOptions)</code> becomes briven&apos;s
          server-side session helper. nextauth&apos;s <code>useSession()</code> becomes
          briven&apos;s <code>useSession()</code> hook from <code>@briven/react</code>.
        </p>
        <Snippet>{`// before — nextauth on next.js
import { getServerSession } from 'next-auth';

export default async function Page() {
  const session = await getServerSession(authOptions);
  if (!session) return <SignInPrompt />;
  return <Dashboard user={session.user} />;
}

// after — briven
import { brivenServer } from '@briven/react/server';

export default async function Page() {
  const session = await brivenServer.session();
  if (!session) return <SignInPrompt />;
  return <Dashboard user={session.user} />;
}`}</Snippet>
      </Section>

      <Section title="callback / event hooks">
        <p>
          nextauth&apos;s <code>callbacks.session</code>, <code>callbacks.jwt</code>, and{' '}
          <code>events.signIn</code> become briven server functions called from the auth
          lifecycle. instead of mutating the session object in a callback, write a briven
          function that returns whatever shape your app needs and call it from your
          dashboard:
        </p>
        <Snippet>{`// before — nextauth callback
callbacks: {
  async session({ session, user }) {
    session.user.role = await getRoleFromDb(user.id);
    return session;
  },
}

// after — briven function the client calls after sign-in
// briven/functions/getCurrentUser.ts
import { query } from '@briven/cli/server';

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    if (!ctx.user) return null;
    const role = await ctx.db('user_roles')
      .select(['role'])
      .where({ user_id: ctx.user.id })
      .first();
    return { ...ctx.user, role: role?.role ?? 'free' };
  },
});`}</Snippet>
      </Section>

      <Section title="cutover checklist">
        <ul className="list-disc pl-5">
          <li>users + accounts imported, row counts match nextauth source</li>
          <li>every nextauth provider re-registered with briven callback URLs</li>
          <li>sign-in flow tested for every provider (manual)</li>
          <li>getServerSession call sites replaced with brivenServer.session()</li>
          <li>useSession imports updated to @briven/react</li>
          <li>nextauth API routes (/api/auth/*) removed</li>
          <li>session secret rotated (do not reuse nextauth&apos;s NEXTAUTH_SECRET)</li>
          <li>parallel-run window planned + observed</li>
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
